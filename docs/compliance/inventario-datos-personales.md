# Inventario de datos personales (Fase 5, LFPDPPP)

## Contexto

Este documento formaliza, en el formato que exige la LFPDPPP (categoría de dato, finalidad, base
legal, plazo de conservación, terceros receptores, medidas de seguridad), el inventario técnico ya
construido en `docs/baseline-challenge-4.md` §2 (tabla por tabla/columna/servicio). No repite ese
detalle campo por campo — lo reorganiza por categoría de dato y lo completa con lo que la ley exige
y la tabla técnica no cubre.

Convención de sensibilidad (idéntica a `docs/baseline-challenge-4.md`): **PII** = dato personal
identificable. **Salud** = dato personal sensible bajo LFPDPPP, incluida la inferencia por
combinación (ej. `Doctor.specialty` + `Appointment` de un paciente revela una condición de salud —
ver la nota completa en `docs/baseline-challenge-4.md` §2, "Nota sobre salud por combinación").

## 1. Categorías de datos personales tratados

| Categoría | Campos | Tablas/servicios | ¿Sensible (salud)? |
|---|---|---|---|
| Identidad y contacto del paciente | email, name, phone | `Patient` (appointments) | No directo, sensible por combinación con sus citas |
| Identidad y contacto de personal (staff/doctor) | email, name | `User` (auth), `Doctor` (doctors) | No |
| Credenciales | passwordHash, tokenHash (RefreshToken) | `User`, `RefreshToken` (auth) | No (sensible como credencial, no como dato de salud) |
| Datos de salud por combinación | patientId + doctorId + dateTime + specialty | `Appointment`/`AppointmentSnapshot`, `Doctor.specialty` | **Sí** |
| Identificadores financieros | stripeCustomerId, stripePaymentIntentId | `Patient`, `Appointment` (appointments); `WebhookEvent`, `OutboxEvent` (payments) | No |
| Payload crudo de proveedor de pagos | objeto completo de eventos de Stripe | `WebhookEvent` (payments) | No, pero incluye PII+financiero sin filtrar |
| Eventos de dominio con PII | snapshots de Patient/Appointment/Doctor en el payload | `OutboxEvent` (los 4 servicios productores), `DeadLetterEntry` (appointments, notifications) | Igual que su origen |
| Auditoría de acceso | actorId, actorRole, ip, userAgent, acción, recurso | `AuditLog` (los 5 servicios, Fase 5) | No (es metadato de acceso, no el dato accedido) |

## 2. Finalidad y base legal

| Finalidad | Base legal (LFPDPPP) | Categorías involucradas |
|---|---|---|
| Prestar el servicio de agendamiento y atención médica contratado | Ejecución de la relación contractual con el titular (o con la clínica, para personal) | Identidad/contacto del paciente, datos de salud por combinación |
| Procesar el cobro de la consulta | Ejecución de la relación contractual + cumplimiento de obligaciones fiscales (CFF) | Identificadores financieros, payload de Stripe |
| Enviar confirmaciones, cancelaciones y avisos de pago fallido (transaccionales) | Ejecución de la relación contractual | Identidad/contacto del paciente |
| Enviar recordatorios de cita (no transaccional) | Interés legítimo, sujeto al derecho de oposición (ARCO, ver §5) | Identidad/contacto del paciente |
| Administrar cuentas de personal (staff/doctor) y su acceso al sistema | Ejecución de la relación laboral/de prestación de servicios | Identidad/contacto de personal, credenciales |
| Auditoría de accesos a datos personales (trazabilidad, detección de uso indebido) | Cumplimiento de obligaciones legales de seguridad (LFPDPPP) + interés legítimo del responsable | Auditoría de acceso |
| Escalada de soporte de plataforma a un tenant específico (RFC-004) | Interés legítimo del responsable, con motivo y expiración obligatorios | Todas, acotadas al tenant y ventana del grant |

## 3. Plazo de conservación (ADR-016)

Constantes hardcodeadas (decisión consciente de ADR-016, revisar cuando se publique el reglamento
de la LFPDPPP), un único módulo nombrado por servicio, nunca dispersas:

| Dato | Plazo | Justificación | Módulo |
|---|---|---|---|
| Datos clínicos/de cita (`Patient` + historial de `Appointment`) | 5 años desde la última cita | NOM-004-SSA3-2012 (expediente clínico) | `services/appointments/src/lib/retention-policy.ts` |
| Datos de facturación/pago (`WebhookEvent`, `OutboxEvent` de pagos) | 5 años | CFF Art. 30 (conservación de contabilidad) | `services/payments/src/lib/retention-policy.ts` |
| Credenciales de cuentas de staff/doctor dadas de baja (`passwordHash`, `RefreshToken`) | 30 días tras `User.active = false` | Ventana de gracia operativa; sin justificación de negocio para retener credenciales de una cuenta inactiva más allá de eso | `services/auth/src/lib/retention-policy.ts` |
| Registros de `AuditLog` (los 5 servicios) | 365 días (S3 Object Lock, compliance mode) | Alineado a `infra/lib/stacks/storage-stack.ts` (bucket ya provisionado, export async pendiente) | N/A (infra) |
| Logs de aplicación (CloudWatch Logs) | dev: 7 días · staging: 30 días · prod: 90 días | Logs ya van redactados de PII (Fase 5, `redact` de Pino) — no necesitan el mismo plazo que los datos vivos | `infra/config/environments.ts` (`logRetentionDays`) |

La purga activa (jobs `purge-expired-data.job.ts` en appointments/payments/auth) se ejecuta bajo
demanda, con modo `--dry-run` que reporta conteos sin borrar. Ver el borrado en cascada verificable
exigido por ADR-016 en cada job: `Appointment` se purga antes que `Patient` (FK `onDelete:
Restrict`), y el reporte incluye conteos de candidatos encontrados vs. efectivamente borrados.

**Pendiente de infra (no implementable sin AWS desplegado, NO VERIFICADO):** retención de backups
automáticos de RDS. No hay instancia RDS desplegada contra la cual verificar la ventana de backup
configurada — queda documentado como pendiente de revisar en el momento del despliegue real.

## 4. Terceros receptores

| Tercero | Campos transferidos | Finalidad | Referencia en código |
|---|---|---|---|
| Stripe (procesador de pagos) | email, name (al crear el Customer); `appointmentId`, `tenantId`, montos (metadata del PaymentIntent) | Procesar el cobro de la consulta | `services/payments/src/modules/payments/payments.service.ts` (creación de Customer/PaymentIntent) |
| Resend (proveedor de email transaccional) | email (`to`), asunto y cuerpo del mensaje (incluye nombre del paciente, fecha de la cita) | Enviar confirmaciones, recordatorios, cancelaciones y avisos de pago fallido | `services/notifications/src/clients/email-channel.ts` |
| Sentry (error tracking) | Contexto de error — puede incluir `appointmentId`/`patientId` si el error los referencia; sin PII directa por diseño (nunca se pasa `email`/`name`/`passwordHash` explícitamente a `Sentry.captureException`) | Diagnóstico de errores no operacionales | `config/sentry.ts` en cada servicio |

Ningún otro tercero recibe datos personales hoy. AWS (RDS, CloudWatch, S3) es el proveedor de
infraestructura, no un tercero receptor con fines propios — encriptación en tránsito (TLS) y en
reposo es responsabilidad de la configuración de infra (**NO VERIFICADO**: no hay RDS desplegado
para confirmar que `storageEncrypted` esté efectivamente activo en tiempo de ejecución, solo en el
código de `infra/lib/stacks/database-stack.ts`).

## 5. Medidas de seguridad implementadas

- **Aislamiento por tenant**: Row-Level Security en Postgres (`app.current_tenant`), forzado con
  `FORCE ROW LEVEL SECURITY` — ningún query de `app_role` puede leer filas de otro tenant, ni por
  bug de aplicación (ver Fase 3a/3b).
- **Audit log inmutable**: append-only por privilegio de motor (`GRANT SELECT, INSERT` sin
  `UPDATE`/`DELETE` para `app_role`), verificado con tests de integración contra Postgres real que
  confirman el `permission denied` (Fase 5, ADR-013).
- **Redacción de PII en logs**: `redact` de Pino en los 5 servicios (`COMMON_REDACT_PATHS` de
  `@clinica/audit-log`), más el fix puntual de los 2 call sites que logueaban PII en texto plano
  antes de esta fase.
- **RBAC + ABAC**: matriz de permisos por rol (RFC-004) + filtro de propiedad (un doctor solo ve
  sus propias citas) — Fase 4.
- **Escalada de soporte auditada**: acceso de `platform_support` a un tenant requiere motivo,
  expiración corta, y queda registrado (`SupportAccessGrant`, RFC-004) — Fase 4.
- **Cifrado en tránsito**: TLS entre el gateway y los servicios, y hacia terceros (Stripe/Resend
  vía HTTPS). **NO VERIFICADO** para el tráfico interno entre servicios en un despliegue AWS real
  (no hay infra desplegada contra la cual confirmarlo).

## 6. Cambios pendientes de esta fase, explícitamente fuera de alcance

- Hash-chaining del audit log (ADR-013 lo rechazó conscientemente).
- Retención configurable por tenant/categoría (ADR-016 lo rechazó conscientemente).
- Job de export async del `AuditLog` a S3 Object Lock (el bucket ya existe, el job no se
  construyó en esta fase).
- Verificación de encriptación real en RDS/tráfico interno (no hay infra desplegada).

## Referencias

- `docs/baseline-challenge-4.md` §2 — inventario técnico columna por columna (fuente de este
  documento).
- `docs/adr/ADR-013-almacenamiento-audit-log.md`, `docs/adr/ADR-016-retencion-borrado-datos.md`.
- `docs/security/threat-model.md` — amenazas #7 (acceso directo de plataforma) y #9 (integridad
  del audit log).
- `docs/compliance/aviso-de-privacidad.md` — versión orientada al titular de este mismo inventario.
