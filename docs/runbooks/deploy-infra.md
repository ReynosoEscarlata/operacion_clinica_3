# Runbook — Desplegar/destruir la infraestructura (Fase 2)

**Alcance:** los 9 stacks de CDK en `infra/` (`Foundation`, `Network`, `Database`, `Messaging`,
`Storage`, `Identity`, `Compute`, `Edge`, `Observability`). Región `mx-central-1` (ADR-010), una
sola cuenta AWS con 3 entornos lógicos (ADR-009).

**Nunca ejecutado por Claude Code** — este runbook es para el humano. Ver guardrails de
`CLAUDE.md`: ningún despliegue real se hizo durante la Fase 2.

---

## Síntoma / cuándo usar este runbook

- Necesitas levantar el entorno `dev` desde cero (demo del Gate 2: "destruir dev y recrearlo
  desde cero").
- Necesitas promover un cambio de infra a `staging` o `prod`.
- Necesitas destruir un entorno (ej. al final de una sesión de desarrollo, para no dejar el
  medidor corriendo — ver riesgo de "factura inesperada" en la sección 6 del plan maestro).

## Diagnóstico previo

1. Confirma que tienes credenciales de AWS válidas para la cuenta objetivo:
   ```bash
   aws sts get-caller-identity
   ```
2. Confirma que el bootstrap de CDK ya corrió en esa cuenta/región (una sola vez por cuenta):
   ```bash
   npx cdk bootstrap aws://<ACCOUNT_ID>/mx-central-1
   ```
3. Exporta la variable de cuenta correspondiente al entorno (ver `config/environments.ts`):
   ```bash
   export CDK_DEV_ACCOUNT=<account-id>       # o CDK_STAGING_ACCOUNT / CDK_PROD_ACCOUNT
   ```

## Decisión

- ¿Es la primera vez que se despliega este entorno? → sigue "Deploy desde cero".
- ¿Ya existe y solo cambió el código de infra? → `npx cdk diff -c env=<entorno>` primero, revisa
  el diff, luego "Deploy incremental".
- ¿Necesitas destruirlo? → "Destruir entorno".

## Pasos

### Deploy desde cero (ej. `dev`)

```bash
cd infra
npm install
npx cdk bootstrap aws://$CDK_DEV_ACCOUNT/mx-central-1
npx cdk deploy --all -c env=dev --require-approval broadening
```

Orden de despliegue: CDK resuelve automáticamente el orden por las dependencias entre stacks
(Foundation y Network primero, Edge/Observability al final).

**Después del primer deploy:**
1. Suscribe tu email a los topics de alarma (no se hardcodea en el código):
   ```bash
   aws sns subscribe --topic-arn <arn-de-clinica-dev-budget-alerts> --protocol email --notification-endpoint <tu-email>
   aws sns subscribe --topic-arn <arn-de-clinica-dev-operational-alerts> --protocol email --notification-endpoint <tu-email>
   ```
2. Publica las imágenes reales a los 6 repositorios ECR creados (`docker build` + `docker push`
   por servicio) — las task definitions apuntan a `:latest`, que no existe hasta este paso.
3. Verifica el dashboard: `clinica-dev-plataforma` en CloudWatch.

### Deploy incremental

```bash
cd infra
npx cdk diff -c env=<entorno>
# revisar el diff con atención, especialmente cambios a RDS/Cognito (pueden implicar downtime)
npx cdk deploy --all -c env=<entorno> --require-approval broadening
```

### Destruir entorno (ej. `dev`, al terminar una sesión)

```bash
cd infra
npx cdk destroy --all -c env=dev
```

**Verificación de "sin residuos" (Gate 2):** tras el destroy, confirma en la consola de AWS (o
`aws resourcegroupstaggingapi get-resources --tag-filters Key=Environment,Values=dev`) que no
queda ningún recurso con tag `Environment=dev`. Los buckets S3 con Object Lock en modo compliance
(staging/prod, ver ADR-013) **no se pueden destruir dentro del período de retención** — es
intencional, no un bug; `dev` no tiene Object Lock precisamente para que este comando funcione sin
intervención manual.

## Comunicación

- Si el deploy o destroy falla a mitad de camino, no reintentar en loop — capturar el error de
  `cdk deploy`/`destroy`, identificar el stack y recurso específico, y decidir si continuar o
  hacer rollback manual del stack fallido (`aws cloudformation rollback-stack` si CloudFormation
  quedó en `UPDATE_ROLLBACK_FAILED`).
- Avisar en el canal del equipo antes de destruir `staging` o `prod` — a diferencia de `dev`,
  estos tienen `RemovalPolicy.SNAPSHOT`/`RETAIN` y dejarán recursos huérfanos a propósito (backups,
  buckets) que alguien debe limpiar manualmente si el destroy es definitivo.

## Post-mortem

Si un deploy causó un incidente (ej. downtime de RDS por un cambio de instancia), documentar en
`docs/security/threat-model.md` si corresponde a una amenaza ya identificada, o agregar una nueva
fila si no. Actualizar este runbook si el incidente reveló un paso faltante.
