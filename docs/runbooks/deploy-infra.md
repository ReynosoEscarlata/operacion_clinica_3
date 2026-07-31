# Runbook — Desplegar/destruir la infraestructura (Fase 2, actualizado Fase 6)

**Alcance:** los 10 stacks de CDK en `infra/` (`Foundation`, `Network`, `Database`, `Messaging`,
`Storage`, `Identity`, `Compute`, `Edge`, `Observability`, `Cost` — este último agregado en Fase 6,
ADR-017). Región `us-east-1` (ADR-018, reemplaza ADR-010/`mx-central-1`), una sola cuenta AWS con 3
entornos lógicos (ADR-009). El stack `Cost` está pinneado explícitamente a `us-east-1` en el código
(`infra/lib/build-app.ts`, requisito de Budgets/Cost Anomaly Detection) — desde ADR-018 esto
coincide con la región del resto del proyecto, así que **ya no hace falta bootstrap en una segunda
región** (antes de ADR-018, con el resto en `mx-central-1`, sí habría hecho falta).

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
   npx cdk bootstrap aws://<ACCOUNT_ID>/us-east-1
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
npx cdk bootstrap aws://$CDK_DEV_ACCOUNT/us-east-1
npx cdk deploy --all -c env=dev --require-approval broadening
```

Orden de despliegue: CDK resuelve automáticamente el orden por las dependencias entre stacks
(Foundation y Network primero, Edge/Observability al final; `Cost` no depende de ningún otro stack
propio, así que puede desplegarse en cualquier momento del proceso).

**Después del primer deploy:**
1. Suscribe tu email a los 3 topics de alarma (no se hardcodea ningún correo en el código —
   audiencias distintas, ver `infra/README.md`):
   ```bash
   aws sns subscribe --topic-arn <arn-de-clinica-dev-operational-alerts> --protocol email --notification-endpoint <tu-email>
   aws sns subscribe --topic-arn <arn-de-clinica-dev-security-alerts> --protocol email --notification-endpoint <tu-email>
   aws sns subscribe --topic-arn <arn-de-clinica-dev-cost-alerts> --protocol email --notification-endpoint <tu-email>
   ```
2. Activa como Cost Allocation Tag en Billing los tags `Environment`, `ClinicService` y
   `Component` (Fase 6, paso manual no expresable en CloudFormation) — sin esto, el Budget del
   stack `Cost` y el reporte de costo por tenant (`docs/cost/reporte-costo-por-tenant.md`) no ven
   ningún gasto filtrado por esos tags.
3. Publica las imágenes reales a los 6 repositorios ECR creados (`docker build` + `docker push`
   por servicio) — las task definitions apuntan a `:latest`, que no existe hasta este paso.
4. Verifica el dashboard: `clinica-dev-plataforma` en CloudWatch (widgets RED vía EMF, Fase 6).

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
