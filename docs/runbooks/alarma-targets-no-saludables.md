# Runbook — Targets no saludables del gateway (`clinica-<env>-gateway-unhealthy-targets`)

**Alcance:** única alarma sobre `edge.gatewayTargetGroup.metricUnhealthyHostCount()` (ver
`infra/lib/stacks/edge-stack.ts`) — el gateway es el único servicio detrás del ALB público
(RFC-001 del Challenge 4, un solo punto de entrada). Existe desde Fase 2; este runbook es
retroactivo (Fase 6, ADR-017).

**Nunca ejecutado por Claude Code.**

---

## Síntoma

Mensaje en `clinica-<env>-operational-alerts`: `>=1` target del gateway marcado unhealthy por el
ALB, sostenido 2 períodos de evaluación.

## Diagnóstico

1. `aws elbv2 describe-target-health --target-group-arn <arn-target-group-gateway>` — qué
   instancias/tasks están unhealthy y por qué (`TargetHealthDescriptions[].TargetHealth.Reason`).
2. `aws ecs describe-tasks --cluster clinica-<env>-cluster --tasks <task-arns>` — estado de la
   task ECS asociada (¿crasheó? ¿el healthcheck del contenedor está fallando?).
3. CloudWatch Logs del gateway (`/clinica/gateway`) en la ventana de la alarma — buscar el error
   que causó que `GET /health` empezara a fallar.
4. Confirma que no es un efecto del sidecar de X-Ray (Fase 6): si `xray-daemon` está marcado
   `essential: false` no debería tumbar la task completa, pero verificar igual si el deploy
   coincide con la introducción del sidecar.

## Decisión

- ¿Es una sola task, y las demás están sanas? → El ALB ya dejó de enrutarle tráfico
  automáticamente; esperar a que ECS la reemplace (circuit breaker + rollback ya configurado, ver
  `clinic-service.ts`) o forzar el reemplazo.
- ¿Son todas las tasks del gateway? → Incidente real de disponibilidad — priorizar diagnóstico
  inmediato, el gateway es el único punto de entrada (sin gateway, no hay tráfico a ningún
  servicio).
- ¿Coincide con un deploy reciente? → Candidato fuerte a rollback antes de seguir investigando.

## Pasos

```bash
# Forzar reemplazo de tasks unhealthy:
aws ecs update-service --cluster clinica-<env>-cluster --service gateway --force-new-deployment

# Si el deploy reciente es sospechoso, rollback a la task definition anterior:
aws ecs update-service --cluster clinica-<env>-cluster --service gateway \
  --task-definition <task-def-anterior-arn>
```

## Verificación

- `describe-target-health` muestra todos los targets `healthy`.
- Tráfico normal fluyendo (revisar `RequestCount`/error rate del gateway en el dashboard).

## Comunicación

Si son todas las tasks (incidente de disponibilidad total), notificar de inmediato — es el único
punto de entrada de la plataforma completa, no un servicio individual degradado.

## Post-mortem

Documentar en `docs/security/threat-model.md` si el incidente reveló una amenaza no contemplada
(ej. un endpoint del gateway sin protección adecuada que permitió tumbarlo). Actualizar este
runbook si el diagnóstico reveló un paso faltante.
