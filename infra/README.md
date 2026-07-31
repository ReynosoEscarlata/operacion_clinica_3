# Infraestructura — Challenge 5, Fase 2

CDK en TypeScript (ADR-008) que aprovisiona la fundación AWS para los 5 servicios existentes
(`auth`, `appointments`, `doctors`, `payments`, `notifications`) + `gateway`, en `us-east-1`
(ADR-018, reemplaza ADR-010/`mx-central-1`).

**Estado:** código generado y validado con `cdk synth`. **Nada se ha desplegado.** El deploy real
lo ejecuta un humano — ver guardrails de `CLAUDE.md` ("NUNCA despliegues a AWS").

## Dos adaptaciones frente al texto literal del plan maestro

El prompt de la Fase 2 (`claude/PLAN-challenge-5-plataforma-para-todos.md`) describe un "landing
zone" con Organizations y RDS Multi-AZ. Antes de escribir código se detectaron y resolvieron con
Ricardo dos contradicciones frente a ADRs ya aceptados (el propio prompt exige parar y preguntar
en ese caso):

1. **Sin AWS Organizations** (ADR-009: una sola cuenta con 3 entornos lógicos). `foundation-stack`
   reemplaza "Organizations + SCPs + IAM Identity Center" por: CloudTrail de cuenta única (no
   organizacional) + AWS Budget con alerta desde el día 1. El aislamiento entre `dev`/`staging`/
   `prod` se logra por **tag y naming** (`Environment=dev|staging|prod`, prefijo
   `clinica-${env}-*` en cada recurso), no por límite de cuenta. Esto significa que un error de
   IAM en `dev` podría, en teoría, alcanzar `prod` — es el trade-off aceptado explícitamente en
   ADR-009, no un descuido.
2. **RDS Single-AZ por defecto** (ADR-015: backup & restore, no warm standby). Las 5 instancias
   RDS son Single-AZ salvo que `config/environments.ts` diga lo contrario por entorno/servicio —
   `multiAz: boolean` es un parámetro de configuración explícito, apagado en los 3 entornos hoy.

## Estructura

```
infra/
  bin/infra.ts                 # entry point delgado -- llama a lib/build-app.ts
  lib/build-app.ts             # wiring real de los 10 stacks (Fase 6: reusado también por
                                # infra/test/alarmas-tienen-runbook.test.ts)
  lib/stacks/                  # 10 stacks: foundation, network, database, messaging, storage,
                                # identity, compute, edge, observability, cost (Fase 6, us-east-1)
  lib/constructs/               # ClinicService, QueueWithDlq, SecureBucket, AlarmWithRunbook (Fase 6)
  config/environments.ts        # tallas/flags por entorno, sin secretos
```

## Prerrequisitos

- Node.js >= 20, AWS CLI configurado (para `deploy` real; `synth` no lo necesita).
- `npm install` dentro de `infra/`.
- Para un **deploy real** (no cubierto por esta fase): `npx cdk bootstrap` contra la cuenta/región
  reales, con `CDK_DEV_ACCOUNT`/`CDK_STAGING_ACCOUNT`/`CDK_PROD_ACCOUNT` en el entorno (ver
  `config/environments.ts` — sin esas variables, usa una cuenta ficticia `000000000000` pensada
  solo para `synth` local).

## Comandos

| Comando | Qué hace |
|---|---|
| `npm run typecheck` | `tsc --noEmit` sobre `bin/`, `lib/`, `config/` |
| `npm run lint` | ESLint |
| `npx cdk synth -c env=dev` | Sintetiza las 10 stacks del entorno `dev` a `cdk.out/` |
| `npx cdk list -c env=<entorno>` | Lista las 10 stacks del entorno |
| `npx cdk diff -c env=<entorno>` | Diff contra lo desplegado (requiere credenciales reales) |
| `npx cdk deploy --all -c env=<entorno>` | **Deploy real — NO ejecutado en esta fase** |
| `npx cdk destroy --all -c env=dev` | **Destroy real — NO ejecutado en esta fase** |

`cdk synth`/`cdk list` se validaron para los 3 entornos (`dev`, `staging`, `prod`) sin necesitar
credenciales reales de AWS — ver nota de `--validation` abajo.

## Nota sobre `cdk synth` y el linter de validación de templates

Las versiones recientes de `aws-cdk-lib` corren, tras sintetizar, un linter de CloudFormation que
en algunos casos intenta llamar a la API de AWS (para verificar disponibilidad de recursos por
región, por ejemplo). Con la cuenta ficticia usada para validar esta fase, eso produce un error
bloqueante salvo que se agregue `--validation=false` al comando. Este proyecto validó con:

```bash
npx cdk synth -c env=dev --validation=false
```

Los 10 templates se generan correctamente en los 3 entornos. El linter reporta además, como
**warnings informativos** (no bloqueantes, y no relacionados con el flag anterior):

- Advertencia de "no hardcodear AZs" — es intencional: se hardcodea `${region}a/b/c` en
  `network-stack.ts` para que `cdk synth` no necesite hacer un lookup de contexto contra AWS real
  (que fallaría sin credenciales). Tras ADR-018 (región `us-east-1`, reemplaza `mx-central-1`) esto
  ya no es una incertidumbre real — `us-east-1a/b/c` es la nomenclatura estándar y estable de una
  de las regiones más antiguas de AWS, a diferencia de la duda genuina que existía sobre
  `mx-central-1` (región nueva, ver el ADR-010 original).
- Advertencia de "FromPort/ToPort requeridos" sobre las reglas de seguridad hacia RDS — falso
  positivo confirmado: esos campos sí están presentes en el template sintetizado, como referencia
  cruzada (`Fn::ImportValue`) al puerto de cada instancia RDS, no como literal — el linter no sabe
  inspeccionar tokens de CDK resueltos en deploy.

`AWS::Budgets::Budget` (usado en `cost-stack.ts`) ya no genera warning de región: su API vive
nativamente en `us-east-1`, que ahora es la región del proyecto — el pin explícito de esa stack a
`us-east-1` (ver comentario en `lib/build-app.ts`) queda por claridad, aunque ya coincide con
`config.region`.

## Decisiones de diseño no obvias

- **Dependencias circulares de CloudFormation entre stacks**: se encontraron y corrigieron dos
  ciclos reales durante la validación (no teóricos — `cdk synth` los detectó):
  1. Entre `database-stack` y `compute-stack`: la regla de seguridad que permite tráfico de una
     task hacia su RDS se crea con `ec2.CfnSecurityGroupIngress` explícito **dentro de
     compute-stack**, no con `securityGroup.addIngressRule(...)` (que habría atado la regla al
     recurso de `database-stack`, creando una dependencia inversa).
  2. Entre `compute-stack` y `edge-stack`: el target group del gateway se crea **en edge-stack**,
     no en el construct `ClinicService` — adjuntar un `ecs.FargateService` a un target group de
     otro stack ata automáticamente el servicio ECS a la existencia del listener, y si el target
     group vive en el stack del servicio, eso cierra un ciclo con la referencia inversa que el
     ALB necesita. La regla de seguridad ALB→gateway sigue el mismo patrón, creada en
     `bin/infra.ts` después de que ambos stacks existen.
- **Solo el gateway tiene target group real** (atado al ALB). Los otros 5 servicios se alcanzan
  únicamente vía Cloud Map (`*.clinica.local`) desde el gateway o entre ellos — consistente con
  RFC-001 del Challenge 4 (el gateway es el único punto de entrada).
- **`DATABASE_URL` no se arma automáticamente.** Las credenciales de RDS generadas por CDK solo
  incluyen `username`/`password` en Secrets Manager — host/puerto/nombre de base no son
  sensibles y se pasan como variables de entorno planas (`DB_HOST`, `DB_PORT`, `DB_NAME`,
  `DB_USER`, `DB_PASSWORD`). **La Fase 3 debe actualizar el `config/env.ts` de cada servicio** para
  construir el connection string de Prisma en runtime a partir de esas variables — hoy cada
  servicio espera una única `DATABASE_URL`. No se tocó código de aplicación en esta fase.
- **Rate limiting solo por IP en WAF**, no por tenant — leer el claim `tenant_id` del JWT dentro de
  una regla WAF administrada no es directo; rate limiting por tenant es trabajo de middleware de
  aplicación (Fase 3/6).
- **Imágenes de contenedor**: se crean 6 repositorios ECR, las task definitions referencian
  `:latest`. Publicar la imagen real (`docker build` + `docker push`, o el pipeline de CI/CD de la
  Fase 9) es un paso posterior — no se requiere Docker corriendo para validar esta fase.
- **Sin dominio ni certificado ACM**: el listener del ALB es HTTP:80, no HTTPS:443. Migrar a HTTPS
  es un cambio acotado (un certificado + un listener) una vez que exista un dominio — no decidido
  todavía.

## Preguntas abiertas para el humano

1. ~~¿`AWS::Budgets::Budget` funciona igual en `mx-central-1`...?~~ Resuelto por ADR-018: el
   proyecto entero pasó a `us-east-1`, la región nativa de Budgets — ya no aplica.
2. ~~Nombres reales de AZ de `mx-central-1`...~~ Resuelto por ADR-018: `us-east-1a/b/c` es
   nomenclatura estándar y estable, sin la incertidumbre que tenía la región anterior.
3. ¿Se acepta HTTP:80 sin cifrado en tránsito hasta que exista un dominio, o esto bloquea el
   primer deploy a un entorno real (aunque sea `dev`)?
4. La Fase 3 necesita decidir cómo se compone `DATABASE_URL` en cada servicio a partir de las
   variables discretas (`DB_HOST`/`DB_PORT`/`DB_NAME`/`DB_USER`/`DB_PASSWORD`) — ¿en el propio
   `env.ts` de cada servicio, o en un script de bootstrap antes de arrancar Prisma?
5. Suscripción de email a los topics de alarma — no se hardcodeó ningún correo en el código; se
   suscribe manualmente post-deploy. Tres topics con audiencias distintas (Fase 6, ADR-017):
   `clinica-<env>-operational-alerts` (guardia técnica: CPU, 5xx, latencia, DLQ, RDS — región del
   proyecto), `clinica-<env>-security-alerts` (acceso cross-tenant confirmado, posible incidente
   LFPDPPP — región del proyecto), `clinica-<env>-cost-alerts` (presupuesto + Cost Anomaly
   Detection — **en `us-east-1`**, el stack `Cost` está pinneado ahí incluso si el resto del
   proyecto usara otra región en el futuro):
   ```bash
   aws sns subscribe --topic-arn <arn-operational-o-security> --protocol email --notification-endpoint <tu-email>
   aws sns subscribe --region us-east-1 --topic-arn <arn-cost> --protocol email --notification-endpoint <tu-email>
   ```
6. Activar como Cost Allocation Tag en Billing los tags `Environment`, `ClinicService` y
   `Component` (Fase 6) — paso manual no expresable en CloudFormation; sin esto, el Budget y el
   reporte de costo por tenant (`docs/cost/reporte-costo-por-tenant.md`) no ven ningún gasto
   filtrado por esos tags aunque los recursos ya estén etiquetados.
