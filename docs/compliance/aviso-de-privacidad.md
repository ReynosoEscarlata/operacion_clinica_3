# Aviso de privacidad

**Última actualización:** 2026-07-31 — agregada la sección "Transferencia internacional de datos"
tras ADR-018 (cambio de región a `us-east-1`). Contenido original de Fase 5 del plan de plataforma
multi-tenant (ver `claude/PLAN-challenge-5-plataforma-para-todos.md`). Este aviso debe revisarse
cuando se publique el reglamento de la LFPDPPP (ADR-016) o cuando cambie cualquier finalidad,
tercero o plazo descrito abajo.

## Responsable del tratamiento

Cada clínica que opera sobre esta plataforma (el "tenant") es responsable de los datos personales
de sus propios pacientes y personal. La plataforma (Clínica Scheduler) actúa como encargada del
tratamiento por cuenta de cada clínica, bajo aislamiento técnico garantizado por tenant (ver
"Medidas de seguridad" más abajo).

## Datos personales que recabamos

Recabamos los datos descritos en detalle en `docs/compliance/inventario-datos-personales.md`. En
resumen:

- **De pacientes**: nombre, email, teléfono, y los datos de tu cita (fecha, doctor, especialidad)
  — esta combinación se trata como dato de salud sensible bajo la LFPDPPP, aunque ninguna columna
  individual lo sea por sí sola.
- **De personal de la clínica** (staff, doctores, administradores): nombre, email, credenciales de
  acceso.
- **Financieros**: identificadores de Stripe asociados a tu método de pago (nunca el número de
  tarjeta completo — eso lo procesa Stripe directamente, nunca pasa por nuestros servidores).

## Para qué usamos tus datos personales

1. Agendar y gestionar tu cita médica.
2. Procesar el cobro de la consulta.
3. Enviarte confirmaciones, cambios y cancelaciones de tu cita (comunicación transaccional, no
   puedes optar por no recibirla mientras tengas una cita activa — es parte del servicio).
4. Enviarte recordatorios de tu próxima cita (no transaccional — puedes ejercer tu derecho de
   oposición para dejar de recibirlos, ver abajo).
5. Administrar el acceso de personal autorizado a la plataforma.
6. Auditar quién accede a tus datos, para detectar y prevenir accesos indebidos.

## Con quién compartimos tus datos

- **Stripe** (procesamiento de pagos): tu email y nombre al crear tu perfil de cliente; monto e
  identificador de tu cita al procesar el cobro.
- **Resend** (envío de correos): tu email y el contenido del correo (confirmaciones, recordatorios,
  cancelaciones).

No vendemos ni compartimos tus datos con nadie más. No usamos tus datos con fines de mercadotecnia
ajenos al servicio que contrataste.

## Transferencia internacional de datos

Tus datos, incluidos los de salud, se alojan en infraestructura de Amazon Web Services en la
región `us-east-1` (Virginia, Estados Unidos) — no dentro de México (ADR-018, que reemplaza la
decisión original de `mx-central-1` de ADR-010). Esto constituye una transferencia internacional
de datos personales bajo la LFPDPPP. AWS aplica cifrado en tránsito y en reposo sobre esos datos
(ver "Medidas de seguridad" abajo). **Pendiente antes de operar con datos de pacientes reales**:
formalizar el mecanismo de transferencia (cláusulas contractuales tipo o equivalente) — ver
ADR-018, sección Consecuencias.

## Cuánto tiempo conservamos tus datos

- Datos de tu expediente/citas: 5 años desde tu última cita (norma NOM-004-SSA3-2012 de expediente
  clínico).
- Datos de facturación: 5 años (obligación fiscal, CFF Art. 30).

El detalle completo, incluyendo la conservación de credenciales de personal y de nuestros propios
registros de auditoría, está en `docs/compliance/inventario-datos-personales.md` §3.

## Tus derechos ARCO

Tienes derecho a **A**cceder, **R**ectificar, **C**ancelar y **O**ponerte al tratamiento de tus
datos personales. Como paciente, no necesitas crear una cuenta — el enlace/UUID de tu cita es tu
credencial para ejercer estos derechos directamente:

| Derecho | Cómo ejercerlo |
|---|---|
| **Acceso** — saber qué datos tenemos de ti y quién los ha consultado | `GET /v1/patients/:id/arco-export` — devuelve tus datos, tus citas, y el historial de quién accedió a tu información |
| **Rectificación** — corregir tu nombre o teléfono | `PATCH /v1/patients/:id` |
| **Cancelación** — solicitar el borrado de tus datos | `POST /v1/patients/:id/arco-cancellation` — borra tu registro y tus citas de inmediato, sin esperar al plazo de conservación ordinario |
| **Oposición** — dejar de recibir recordatorios no transaccionales | `PATCH /v1/patients/:id/arco-opposition` con `{ "optOut": true }` |

Toda solicitud de acceso, cancelación u oposición queda registrada en nuestro audit log inmutable
como evidencia de que la ejerciste y de cuándo lo hiciste.

## Medidas de seguridad

Tus datos están aislados técnicamente por clínica (ninguna clínica puede ver los datos de
pacientes de otra, forzado a nivel de base de datos). El acceso de personal de soporte de la
plataforma a los datos de tu clínica, cuando es estrictamente necesario, requiere un motivo
registrado y expira automáticamente. Nuestros registros de auditoría no pueden modificarse ni
borrarse una vez escritos. El detalle técnico completo está en
`docs/compliance/inventario-datos-personales.md` §5.

## Cambios a este aviso

Revisaremos este aviso cuando cambie alguna finalidad, se agregue un nuevo tercero receptor, o se
publique el reglamento de la LFPDPPP. La versión vigente siempre vive en este mismo documento.

## Referencias

- `docs/compliance/inventario-datos-personales.md` — versión técnica completa de este aviso.
- `docs/adr/ADR-013-almacenamiento-audit-log.md`, `docs/adr/ADR-016-retencion-borrado-datos.md`.
- `docs/adr/ADR-018-cambio-region-us-east-1.md` — decisión de región y su implicación de
  transferencia internacional (reemplaza `ADR-010-region-residencia-datos.md`).
