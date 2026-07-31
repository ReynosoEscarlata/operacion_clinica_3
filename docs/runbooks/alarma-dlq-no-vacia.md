# Runbook — DLQ no vacía (`clinica-<env>-dlq-<cola>-no-vacia`)

**Alcance:** 5 alarmas, una por cada dead-letter queue física de SQS (`appointments-domain-events`,
`notifications-domain-events`, `appointment-expiration`, `appointment-reminders`,
`appointment-noshow` — ver `infra/lib/stacks/messaging-stack.ts`). Existen desde Fase 2; este
runbook es retroactivo (Fase 6, ADR-017 — no tenían runbook hasta ahora).

**Nunca ejecutado por Claude Code.**

---

## Síntoma

Mensaje en `clinica-<env>-operational-alerts`: `>=1` mensaje visible en una DLQ física.

Recordar el diseño (ADR-014, `packages/messaging/src/sqs-consumer.ts`): la DLQ física es una red
de seguridad **secundaria**. El camino esperado para "un evento agotó sus reintentos" ya pasa por
`onDeadLetter` dentro del consumer principal, que persiste en la tabla `DeadLetterEntry` de la
aplicación (consultable vía `GET /v1/admin/dead-letter` o `/v1/dead-letter`) **con el error real en
mano** y borra el mensaje explícitamente — nunca debería llegar a la DLQ física por esa vía. Un
mensaje en la DLQ física casi siempre significa que el proceso murió a mitad de procesarlo (crash,
deploy, OOM) antes de poder decidir.

## Diagnóstico

1. Identifica la cola por el nombre de la alarma (`dlq-<cola>-no-vacia`).
2. `aws sqs get-queue-attributes --queue-url <dlq-url> --attribute-names ApproximateNumberOfMessages`
   — cuántos mensajes hay.
3. Revisa CloudWatch Logs del servicio dueño de esa cola en la ventana de tiempo de la alarma
   (`docs/runbooks/consultas-logs-insights.md`) — busca un crash, un deploy, o un error no
   capturado justo antes.
4. Confirma si el poller de drenado (`startDlqDrain`, ver `packages/messaging/src/dlq-drain.ts`)
   ya movió el mensaje a `DeadLetterEntry` con el mensaje de error genérico
   (`"Movido automáticamente al DLQ de SQS -- error original no disponible"`) — si sí, ya está en
   la tabla de la aplicación y el mensaje de SQS debería estar vacío de nuevo.

## Decisión

- ¿El drenado automático ya lo movió a `DeadLetterEntry`? → Nada más que hacer acá; ve al panel de
  dead-letter de la aplicación para decidir si reintentar el evento.
- ¿Sigue en la DLQ física y no se mueve? → El poller de drenado no está corriendo o falló — revisa
  que el proceso del servicio esté up (`ECS Service` healthy) y sus logs para el error del poller.
- ¿Es un volumen alto y sostenido (no un caso aislado)? → Puede ser un bug sistemático en el
  handler de ese tipo de evento — no reintentar en loop, investigar la causa raíz primero.

## Pasos

```bash
# Ver los mensajes sin borrarlos (para inspección manual, no consume el mensaje):
aws sqs receive-message --queue-url <dlq-url> --max-number-of-messages 10 --visibility-timeout 0

# Confirmar que el poller de drenado los está moviendo (esperar 1 ciclo, ~5s por defecto):
aws sqs get-queue-attributes --queue-url <dlq-url> --attribute-names ApproximateNumberOfMessages
```

Si el poller no está corriendo (proceso caído), reiniciar el servicio (ECS lo hace automático si
el healthcheck falla; si no, forzar un nuevo deployment):
```bash
aws ecs update-service --cluster clinica-<env>-cluster --service <servicio> --force-new-deployment
```

## Verificación

- `ApproximateNumberOfMessages` de la DLQ física vuelve a 0.
- La entrada correspondiente aparece en `DeadLetterEntry` (vía el endpoint admin/dead-letter del
  servicio dueño).

## Comunicación

Si el volumen es alto (decenas de mensajes, no 1-2 aislados), avisar en el canal del equipo antes
de reintentar nada en bloque — puede ser un evento "venenoso" que rompería de nuevo si se reintenta
sin corregir la causa.

## Post-mortem

Si la causa fue un bug en un handler, el fix debe incluir un test de regresión (unit o de
integración contra LocalStack real, según corresponda) que reproduzca el caso que causó el
crash/error, no solo el fix en sí.
