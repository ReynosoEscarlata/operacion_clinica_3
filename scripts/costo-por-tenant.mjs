// Reporte de costo por tenant (Fase 6, ADR-017) -- ver el método completo en
// docs/cost/reporte-costo-por-tenant.md. Ejecutado por el humano, NUNCA por
// Claude Code (guardrail del repo): este script llama a Cost Explorer y
// modifica nada de infraestructura, pero de todas formas ninguna sesión de
// Claude Code debe correrlo -- solo generar/editar el código.
//
// Es una APROXIMACIÓN, no chargeback: el modelo shared-DB (ADR-005) no tiene
// un recurso de AWS atribuible a un tenant individual. Ver el documento de
// método para las limitaciones explícitas antes de usar estos números para
// facturar a alguien.
import { CostExplorerClient, GetCostAndUsageCommand } from '@aws-sdk/client-cost-explorer';
import {
  CloudWatchLogsClient,
  StartQueryCommand,
  GetQueryResultsCommand,
} from '@aws-sdk/client-cloudwatch-logs';

const SERVICE_NAMES = ['auth', 'appointments', 'doctors', 'payments', 'notifications', 'gateway'];
const PLATFORM_COMPONENTS = ['network', 'messaging', 'storage', 'identity', 'edge', 'foundation'];
const LOGS_QUERY_TIMEOUT_MS = 30_000;
const LOGS_QUERY_POLL_INTERVAL_MS = 1_000;

const parseArgs = (argv) => {
  const args = { env: 'dev' };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--env') args.env = argv[++i];
    else if (arg === '--desde') args.desde = argv[++i];
    else if (arg === '--hasta') args.hasta = argv[++i];
  }
  if (!args.desde || !args.hasta) {
    throw new Error('Uso: node costo-por-tenant.mjs --env <dev|staging|prod> --desde YYYY-MM-DD --hasta YYYY-MM-DD');
  }
  return args;
};

// Cost Explorer es una API global, pero el SDK exige una región de cliente
// -- us-east-1, mismo criterio que infra/lib/stacks/cost-stack.ts.
const costExplorer = new CostExplorerClient({ region: 'us-east-1' });

// CloudWatch Logs de la región real donde corre la app (mx-central-1,
// ADR-010) -- distinto de Cost Explorer, que es global desde us-east-1.
const logsClient = new CloudWatchLogsClient({ region: process.env.AWS_REGION ?? 'mx-central-1' });

const getCostByTag = async (tagKey, desde, hasta) => {
  const result = await costExplorer.send(
    new GetCostAndUsageCommand({
      TimePeriod: { Start: desde, End: hasta },
      Granularity: 'MONTHLY',
      Metrics: ['UnblendedCost'],
      GroupBy: [{ Type: 'TAG', Key: tagKey }],
    }),
  );

  const byTagValue = {};
  for (const period of result.ResultsByTime ?? []) {
    for (const group of period.Groups ?? []) {
      // AWS devuelve el group key como "ClinicService$auth" -- la parte
      // después de "$" es el valor real del tag.
      const rawKey = group.Keys?.[0] ?? '';
      const value = rawKey.includes('$') ? rawKey.split('$')[1] : rawKey;
      const amount = Number(group.Metrics?.UnblendedCost?.Amount ?? '0');
      byTagValue[value] = (byTagValue[value] ?? 0) + amount;
    }
  }
  return byTagValue;
};

const runLogsInsightsQuery = async (logGroupName, desde, hasta) => {
  const start = await logsClient.send(
    new StartQueryCommand({
      logGroupNames: [logGroupName],
      startTime: Math.floor(new Date(desde).getTime() / 1000),
      endTime: Math.floor(new Date(hasta).getTime() / 1000),
      queryString: `fields tenantId | filter ispresent(tenantId) | stats count(*) as requests by tenantId`,
    }),
  );

  const queryId = start.queryId;
  const deadline = Date.now() + LOGS_QUERY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const result = await logsClient.send(new GetQueryResultsCommand({ queryId }));
    if (result.status === 'Complete') {
      const byTenant = {};
      for (const row of result.results ?? []) {
        const tenantId = row.find((field) => field.field === 'tenantId')?.value;
        const requests = Number(row.find((field) => field.field === 'requests')?.value ?? '0');
        if (tenantId) byTenant[tenantId] = requests;
      }
      return byTenant;
    }
    await new Promise((resolve) => setTimeout(resolve, LOGS_QUERY_POLL_INTERVAL_MS));
  }
  throw new Error(`Timeout esperando resultados de Logs Insights para ${logGroupName}`);
};

const buildReport = async ({ env, desde, hasta }) => {
  console.log(`Reporte de costo por tenant -- entorno ${env}, ${desde} a ${hasta}`);
  console.log('APROXIMACIÓN, no chargeback -- ver docs/cost/reporte-costo-por-tenant.md\n');

  const costByService = await getCostByTag('ClinicService', desde, hasta);
  const costByComponent = await getCostByTag('Component', desde, hasta);

  const platformFixedCost = PLATFORM_COMPONENTS.reduce(
    (sum, component) => sum + (costByComponent[component] ?? 0),
    0,
  );

  const trafficShareByService = {};
  for (const serviceName of SERVICE_NAMES) {
    const logGroupName = `/clinica/${serviceName}`;
    try {
      trafficShareByService[serviceName] = await runLogsInsightsQuery(logGroupName, desde, hasta);
    } catch (error) {
      console.warn(`No se pudo consultar ${logGroupName}: ${error.message}`);
      trafficShareByService[serviceName] = {};
    }
  }

  const allTenantIds = new Set();
  for (const byTenant of Object.values(trafficShareByService)) {
    for (const tenantId of Object.keys(byTenant)) allTenantIds.add(tenantId);
  }

  const tenantCount = allTenantIds.size || 1;
  const platformCostPerTenant = platformFixedCost / tenantCount;

  const costPerTenant = {};
  for (const tenantId of allTenantIds) {
    let total = platformCostPerTenant;
    for (const serviceName of SERVICE_NAMES) {
      const requestsByTenant = trafficShareByService[serviceName];
      const totalRequests = Object.values(requestsByTenant).reduce((sum, n) => sum + n, 0);
      if (totalRequests === 0) continue;
      const share = (requestsByTenant[tenantId] ?? 0) / totalRequests;
      total += (costByService[serviceName] ?? 0) * share;
    }
    costPerTenant[tenantId] = total;
  }

  console.log('Costo estimado por tenant (USD):');
  for (const [tenantId, cost] of Object.entries(costPerTenant).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${tenantId}: $${cost.toFixed(2)}`);
  }
  console.log(`\nCosto fijo de plataforma (repartido en partes iguales): $${platformFixedCost.toFixed(2)} / ${tenantCount} tenants = $${platformCostPerTenant.toFixed(2)} c/u`);
};

buildReport(parseArgs(process.argv.slice(2))).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
