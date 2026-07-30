import { RemovalPolicy } from 'aws-cdk-lib';

// Nombres de los 5 servicios de dominio (Challenge 4) + gateway. No incluye el
// monolito legado (src/ en la raíz) — ese sigue corriendo fuera de AWS, en
// Docker Compose, según lo confirmado en Fase 0 (docs/baseline-challenge-4.md).
export const SERVICE_NAMES = ['auth', 'appointments', 'doctors', 'payments', 'notifications'] as const;
export type ServiceName = (typeof SERVICE_NAMES)[number];

export const CONTAINER_NAMES = [...SERVICE_NAMES, 'gateway'] as const;
export type ContainerName = (typeof CONTAINER_NAMES)[number];

export interface RdsSizing {
  instanceClass: string;
  instanceSize: string;
  allocatedStorageGb: number;
  // ADR-015: Single-AZ es el default en los tres entornos (backup & restore, no
  // warm standby). Se deja como parámetro de configuración, no hardcodeado en
  // el stack, para poder activarlo puntualmente por servicio si la Fase 7
  // (RFC-disaster-recovery) lo justifica — un cambio de config, no de código.
  multiAz: boolean;
}

export interface FargateSizing {
  cpu: number;
  memoryLimitMiB: number;
  desiredCount: number;
  maxCapacity: number;
}

export interface EnvironmentConfig {
  envName: 'dev' | 'staging' | 'prod';
  account: string;
  region: string;
  // ADR-010: mx-central-1, verificado en Fase 1 (docs/cost/precios-aws-consultados.md)
  // que los 11 servicios de AWS que este proyecto necesita tienen SKU propio ahí.
  natGateways: number;
  rds: Record<ServiceName, RdsSizing>;
  fargate: Record<ServiceName, FargateSizing>;
  // ADR-009: una sola cuenta AWS con 3 entornos lógicos (no Organizations). El
  // aislamiento entre entornos se logra por tag + naming, no por cuenta — ver
  // infra/README.md para el trade-off aceptado.
  removalPolicy: RemovalPolicy;
  budgetLimitUsd: number;
}

const defaultRdsSizing = (multiAz: boolean, allocatedStorageGb = 20): RdsSizing => ({
  instanceClass: 'burstable4gravitongen',
  instanceSize: 'micro',
  allocatedStorageGb,
  multiAz,
});

const defaultFargateSizing = (desiredCount: number): FargateSizing => ({
  cpu: 256,
  memoryLimitMiB: 512,
  desiredCount,
  maxCapacity: desiredCount * 3,
});

const buildRdsConfig = (multiAz: boolean): Record<ServiceName, RdsSizing> =>
  Object.fromEntries(SERVICE_NAMES.map((name) => [name, defaultRdsSizing(multiAz)])) as Record<
    ServiceName,
    RdsSizing
  >;

const buildFargateConfig = (desiredCount: number): Record<ServiceName, FargateSizing> =>
  Object.fromEntries(SERVICE_NAMES.map((name) => [name, defaultFargateSizing(desiredCount)])) as Record<
    ServiceName,
    FargateSizing
  >;

// Cuenta ficticia de contexto para `cdk synth` sin credenciales reales — ver
// decisión de validación del plan de Fase 2. El deploy real usa
// CDK_DEFAULT_ACCOUNT/CDK_DEFAULT_REGION del entorno de quien ejecuta `cdk deploy`.
const PLACEHOLDER_ACCOUNT = '000000000000';
const REGION = 'mx-central-1';

export const ENVIRONMENTS: Record<'dev' | 'staging' | 'prod', EnvironmentConfig> = {
  dev: {
    envName: 'dev',
    account: process.env.CDK_DEV_ACCOUNT ?? PLACEHOLDER_ACCOUNT,
    region: REGION,
    natGateways: 1,
    rds: buildRdsConfig(false),
    fargate: buildFargateConfig(1),
    removalPolicy: RemovalPolicy.DESTROY,
    budgetLimitUsd: 150,
  },
  staging: {
    envName: 'staging',
    account: process.env.CDK_STAGING_ACCOUNT ?? PLACEHOLDER_ACCOUNT,
    region: REGION,
    natGateways: 1,
    rds: buildRdsConfig(false),
    fargate: buildFargateConfig(1),
    removalPolicy: RemovalPolicy.SNAPSHOT,
    budgetLimitUsd: 200,
  },
  prod: {
    envName: 'prod',
    account: process.env.CDK_PROD_ACCOUNT ?? PLACEHOLDER_ACCOUNT,
    region: REGION,
    // Prod evalúa 3 NAT Gateways (uno por AZ) por disponibilidad — documentado
    // como trade-off de costo vs. disponibilidad en infra/README.md, apagado
    // por defecto (1) hasta que el tráfico real lo justifique.
    natGateways: 1,
    rds: buildRdsConfig(false),
    fargate: buildFargateConfig(2),
    removalPolicy: RemovalPolicy.RETAIN,
    budgetLimitUsd: 300,
  },
};

export const getEnvironmentConfig = (envName: string): EnvironmentConfig => {
  if (envName !== 'dev' && envName !== 'staging' && envName !== 'prod') {
    throw new Error(`Entorno desconocido: "${envName}". Usa -c env=dev|staging|prod.`);
  }
  return ENVIRONMENTS[envName];
};
