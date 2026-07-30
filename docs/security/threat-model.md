# Threat Model — Flujo de datos de PII y salud (STRIDE)

**Fase:** 1 del `claude/PLAN-challenge-5-plataforma-para-todos.md`
**Alcance:** el data flow de PII y datos de salud, de punta a punta, sobre el sistema real
descrito en `docs/baseline-challenge-4.md`.
**Estado:** Riesgo residual — pendiente de firma humana (ver sección final).

> Nota legal (ya registrada en el plan maestro, repetida aquí porque calibra severidad): bajo la
> LFPDPPP los datos de salud son datos personales sensibles, y las sanciones se duplican cuando la
> infracción los involucra. Cualquier amenaza que exponga la relación paciente↔especialidad↔cita
> entra automáticamente en la banda de severidad más alta de este documento.

---

## 1. Diagrama de flujo de datos con trust boundaries

```mermaid
flowchart TB
    subgraph TB1["Trust boundary: Internet (no confiable)"]
        Patient["Paciente (sin cuenta,\nposesión de UUID)"]
        Staff["Admin/Staff clínica"]
        StripeExt["Stripe (webhooks)"]
    end

    subgraph TB2["Trust boundary: Perímetro de plataforma (propuesto: WAF/ALB, Fase 2)"]
        WAF["WAF (propuesto)"]
        ALB["ALB (propuesto)"]
        GW["Gateway (Fastify, hoy real)\nverify-jwt.ts + proxy"]
    end

    subgraph TB3["Trust boundary: red interna de servicios (Docker/VPC privada)"]
        AUTH["Auth\nUser, RefreshToken"]
        APT["Appointments\nPatient, Appointment, AppointmentEvent"]
        DOC["Doctors\nDoctor, Availability"]
        PAY["Payments\nWebhookEvent"]
        NOT["Notifications\nsnapshots, NotificationLog"]
    end

    subgraph TB4["Trust boundary: datos en reposo"]
        RDS["5x Postgres\n(uno por servicio)"]
        REDIS["Redis compartido\n(Streams + BullMQ)"]
        S3["S3 (propuesto, Fase 2:\nadjuntos, audit log, backups)"]
        COGNITO["Cognito (propuesto,\nFase 2/4)"]
    end

    subgraph TB5["Trust boundary: terceros externos"]
        STRIPE["Stripe"]
        RESEND["Resend"]
    end

    subgraph TB6["Trust boundary: plataforma (empleados del SaaS)"]
        PLATOPS["platform_admin /\nplatform_support"]
    end

    Patient -->|HTTPS| WAF --> ALB --> GW
    Staff -->|HTTPS + JWT| WAF
    StripeExt -->|webhook firmado| ALB

    GW -->|JWT verificado, JWKS| AUTH
    GW -->|proxy| APT
    GW -->|proxy| DOC
    GW -->|proxy| PAY
    GW -->|proxy /docs, admin| NOT

    APT -->|HTTP síncrono| DOC
    APT -->|HTTP síncrono| PAY
    PAY -->|HTTP| STRIPE
    NOT -->|HTTP| RESEND

    AUTH --> RDS
    APT --> RDS
    DOC --> RDS
    PAY --> RDS
    NOT --> RDS

    APT -->|Outbox relay: AppointmentCreated,\nAppointmentStatusChanged, PatientUpdated| REDIS
    DOC -->|Outbox relay: DoctorCreated/Updated| REDIS
    PAY -->|Outbox relay: PaymentSucceeded/Failed/RefundIssued| REDIS
    REDIS -->|consumer group| APT
    REDIS -->|consumer group| NOT

    APT -.->|adjuntos futuros, Fase 2| S3
    AUTH -.->|Fase 4: JWT claims tenant_id| COGNITO

    PLATOPS -.->|acceso administrativo directo\n(hoy sin control, ver amenaza #7| RDS
```

**Lectura de los trust boundaries:**
- **TB1 → TB2** es el único borde que cruza gente no autenticada. Hoy varias rutas de negocio
  (`POST /v1/appointments`, `GET /v1/appointments/:id`, `PATCH /v1/appointments/:id/cancel`,
  `POST /v1/patients`) son intencionalmente públicas — el paciente no tiene cuenta (RFC-004).
- **TB2 → TB3** hoy no tiene WAF ni ALB reales (Docker Compose local) — se marcan "(propuesto)"
  porque es exactamente lo que la Fase 2 agrega.
- **TB3 → TB4** es donde vive hoy toda la superficie de PII real: 5 bases Postgres + 1 Redis
  compartido, sin ningún control de tenant (RFC-003).
- **TB6** (empleados de plataforma) hoy **no tiene ningún control** — cualquiera con acceso a
  `docker exec`/credenciales de Postgres local puede consultar cualquier tabla directamente. Es la
  amenaza #7 de la lista obligatoria.

---

## 2. Tabla STRIDE

Convención de Impacto/Probabilidad: Alto/Medio/Bajo, calibrado para datos de salud (ver nota
legal). "¿Implementada en qué fase?" referencia el mapa de fases del plan maestro.

| # | Elemento | Amenaza | STRIDE | Impacto | Probabilidad | Mitigación | Fase |
|---|---|---|---|---|---|---|---|
| 1 | Claim de tenant en JWT (a introducir en Fase 3) | `tenant_id` manipulable desde header/query/body del cliente en vez de venir del JWT verificado | Spoofing / Elevation of Privilege | Alto | Media (es el error más natural al portar el middleware actual, que sí lee `x-internal-user-role` de un header interno) | `tenant_id` **solo** desde el claim del JWT firmado por Auth; nunca de header/query/body (guardrail explícito en CLAUDE.md) | 3 |
| 2 | Cualquier endpoint nuevo sobre `Appointment`/`Patient`/`Doctor` (`*.repository.ts`) | Query sin filtro de tenant en un endpoint agregado después de la Fase 3 | Information Disclosure | Alto | Media-alta (ya ocurrió un patrón similar: el bug de `event-consumer.ts` sin XAUTOCLAIM pasó desapercibido varias iteraciones, ver SPEC.md) | RLS con `FORCE ROW LEVEL SECURITY` + repositorio base obligatorio + test meta de cobertura de rutas (Fase 3) | 3 |
| 3 | `GET /v1/appointments/:id`, `GET /v1/patients/:id` (públicas, por posesión de UUID) | Enumeración/IDOR: aunque el ID es UUID v4 (no secuencial, bajo riesgo de fuerza bruta), el diseño ya es "quien tenga el ID, entra" — combinado con multi-tenant, un ID de otro tenant filtrado (ej. por un log, un link compartido) da acceso completo | Information Disclosure | Alto (dato de salud) | Baja para fuerza bruta pura (UUID), media si un ID se filtra por otro canal (logs, capturas de pantalla, soporte) | Mantener respuesta 404 (no 403) ante ID de otro tenant — un 403 ya confirma que el recurso existe; test de enumeración obligatorio (Fase 3) | 3 |
| 4 | Envelope de eventos (`AppointmentCreated`, `PaymentSucceeded`, etc., sin `tenant_id` hoy) | Evento publicado sin `tenant_id`, consumido por un handler que asume el tenant equivocado (o ninguno) | Information Disclosure | Alto | Alta si no se corrige explícitamente — hoy **ningún** evento lleva `tenant_id` (confirmado en baseline) | `tenant_id` obligatorio en el envelope, validado en publish y en consume; evento sin `tenant_id` → DLQ, nunca procesamiento parcial | 3 |
| 5 | Claves de Redis (BullMQ + cache futura) | Cache/colas sin namespace de tenant — colisión de clave entre clínicas | Information Disclosure | Alto | Media (hoy ni siquiera hay namespace por *servicio*: el monolito y `appointments` comparten el mismo Redis físico con nombres de cola similares — ver `docs/backlog-deuda.md` ítem 11) | Prefijo `tenant:{id}:` obligatorio en toda clave; namespacing por servicio también (deuda preexistente) | 3 |
| 6 | S3 (propuesto, Fase 2 — adjuntos de paciente, exports, backups) | Presigned URL con expiración larga o path predecible (ej. `/patients/{id}/adjunto.pdf` adivinable) | Information Disclosure | Alto | N/A hoy (no existe S3 todavía) — riesgo de diseño para cuando se implemente | Expiración corta (minutos), paths con componente aleatorio no derivable del `patientId`, bucket con block public access + política que exige `tenant/{id}/` como prefijo | 2, 5 |
| 7 | Acceso directo a Postgres/Redis (hoy: `docker exec`, credenciales locales; en AWS: consola/`psql` directo) | Empleado de plataforma consultando la DB de prod sin pasar por el audit log de aplicación | Elevation of Privilege / Repudiation | Alto | Alta hoy — **no existe ningún control**, cualquiera con acceso al host puede consultar cualquier tabla | Acceso de soporte con expiración, motivo obligatorio, auditado (RFC-004); en AWS, IAM sin acceso directo a RDS salvo rol de break-glass auditado | 4, 5 |
| 8 | Logs de Pino (`logger.child({ requestId })`, todos los servicios) | Log estructurado que imprime PII (email, nombre, teléfono) en texto plano hacia CloudWatch/stdout | Information Disclosure | Alto | Alta si no se agrega un redactor — hoy ningún servicio tiene redacción de PII en el logger (`lib/logger.ts` de cada servicio serializa el objeto tal cual se le pasa) | Redactor obligatorio en Pino (`redact` config) para campos conocidos de PII antes de Fase 5; test de no-filtración de PII sobre logs de test | 5 |
| 9 | Audit log inmutable (a construir en Fase 5, no existe hoy) | Borrado o alteración del audit log para tapar un acceso indebido | Repudiation | Alto | N/A hoy (no existe el audit log todavía) | Tabla append-only sin `UPDATE`/`DELETE` para el rol de aplicación + export a S3 Object Lock + encadenamiento por hash | 5 |
| 10 | Backups de RDS (propuesto, Fase 2) | Backup restaurado en un entorno de dev con datos reales de pacientes | Information Disclosure | Alto | Media (es una práctica común y cómoda para debugging que nadie prohíbe explícitamente hoy) | Prohibición explícita en runbook + snapshots de dev generados por *seed* sintético, nunca por restore de prod; si se acepta restaurar prod a dev alguna vez, anonimización obligatoria antes | 2, 7 |
| 11 | Consumer de Notifications (`event-handlers.ts`) | Notificación enviada al paciente equivocado por colisión de tenant (ej. dos clínicas con el mismo `appointmentId` si algún día se relajara el UUID, o un bug de routing de eventos) | Information Disclosure | Alto | Baja con UUIDs, pero el riesgo real es un evento cross-tenant mal enrutado (ver amenaza #4) que dispare un email con datos de otro paciente | `tenant_id` en el envelope + verificación de que `AppointmentSnapshot`/`PatientSnapshot` del consumer coincide con el tenant del evento antes de enviar | 3, 5 |
| 12 | `Patient.email/name/phone` (Patient, PatientSnapshot — PII directo) | Exposición vía endpoint público mal filtrado (`GET /v1/patients/:id`, `GET /v1/patients/by-email`) sin tenant | Information Disclosure | Alto | Media | Cubierta por #2 y #3 — este es el dato concreto en riesgo | 3 |
| 13 | `Patient.stripeCustomerId`, `Appointment.stripePaymentIntentId` (identificadores financieros) | Fuga de identificador financiero permite a un atacante correlacionar con datos de Stripe fuera del sistema | Information Disclosure | Medio | Baja-media | Mismos controles de tenant + nunca loguear estos campos completos (redactor de logs, amenaza #8) | 3, 5 |
| 14 | `User.passwordHash`, `RefreshToken.tokenHash` (Auth) | Fuga de hash de contraseña o de refresh token vía backup/log/dump | Information Disclosure (llave para Spoofing posterior) | Alto | Baja (ya se trata como sensible: nunca se loguea en texto plano) | Mantener fuera de logs; considerar rotación de `RefreshToken` más agresiva; ninguna tabla de Auth debe aparecer en un dump exportable sin cifrado | 2, 5 |
| 15 | `Appointment.doctorId` + `Doctor.specialty` (salud por combinación) | Un query o export que una ambas tablas revela que un paciente específico vio a un especialista de una categoría sensible (ej. psiquiatría, oncología) | Information Disclosure (dato de salud sensible) | **Alto (banda máxima por LFPDPPP)** | Media (es exactamente el tipo de join que un dashboard o un reporte de soporte haría sin pensarlo) | Tratar cualquier vista/reporte que una `Appointment` con `Doctor.specialty` como dato de salud sensible de punta a punta — nunca en logs, nunca en exports sin consentimiento explícito documentado | 5 |
| 16 | `Appointment.cancellationReason` (texto libre, marcado REVISAR en baseline) | Un paciente o staff escribe información de salud en un campo de texto libre no diseñado para eso, y ese texto se propaga a logs/eventos/emails sin tratamiento especial | Information Disclosure | Medio-alto (depende de contenido real, no verificado) | Media | Inspeccionar contenido real en Fase 5 (pregunta abierta ya registrada en el baseline); tratar como potencialmente sensible hasta confirmar lo contrario | 5 |
| 17 | Payloads `Json` (`AppointmentEvent.payload`, `OutboxEvent.payload`, `DeadLetterEntry.payload`, `IdempotencyRecord.response`, `WebhookEvent.payload` — en 5 de los 6 esquemas) | Estos campos son "cajas negras" que replican datos de otras tablas (incluyendo PII) sin que su contenido esté validado por un esquema — cualquier cambio de código puede empezar a incluir más PII de la esperada sin que nadie lo note | Information Disclosure | Alto | Media | Documento de contrato de eventos versionado (gap ya detectado, backlog ítem 12) + estos campos entran íntegros al alcance del audit log y del redactor de logs | 1 (documentar), 5 |
| 18 | `NotificationLog.error` (mensaje de error de Resend) | Un mensaje de error de proveedor de email puede incluir la dirección de email destinataria en texto plano dentro del log de error | Information Disclosure | Bajo-medio | Media | Redactor de logs aplica también a este campo; no asumir que un "mensaje de error" es de bajo riesgo solo por su nombre de campo | 5 |
| 19 | Llave de firma JWT de Auth (en memoria del proceso, documentado en `keys.ts`) | Compromiso de credenciales: si el proceso de Auth se compromete, la llave privada vive en memoria y no hay forma de revocarla sin reiniciar (rotando el `kid`) | Spoofing / Elevation of Privilege | Alto | Baja hoy (superficie de ataque pequeña, un solo entorno local), pero crece con múltiples réplicas en ECS Fargate | Persistir la llave en Secrets Manager con rotación (backlog ítem 9, ya detectado en Fase 0); plan de rotación de emergencia documentado en runbook | 2 |
| 20 | Webhook de Stripe (`POST /v1/webhooks/stripe`) | Compromiso o fallo de un proveedor externo (Stripe) — firma inválida aceptada por error, o Stripe mismo comprometido | Tampering / Spoofing | Medio | Baja (ya hay verificación de firma + idempotencia, `WebhookEvent`) | Mantener verificación de firma (ya implementada); documentar en RFC-DR (Fase 7) el escenario de "Stripe caído/comprometido" como parte de la matriz de dependencias | 7 |
| 21 | `Doctor.name/email` (dato de personal, PII de menor sensibilidad que la de pacientes pero PII al fin) | Mismo vector que #12 pero sobre personal médico, relevante para el catálogo de datos personales de la Fase 5 (no solo pacientes son sujetos de datos) | Information Disclosure | Medio | Media | Mismos controles de tenant; incluir explícitamente en el inventario de datos personales de la Fase 5, no asumir que "solo pacientes cuentan" | 3, 5 |

---

## 3. Riesgo residual aceptado

**Aún no firmado — pendiente de que el humano lo revise y feche.**

Candidatos a riesgo residual aceptado (a decidir, no decisión de Claude Code):
- Amenaza #3 (posesión de UUID como mecanismo de autorización para pacientes sin cuenta) es una
  decisión de producto ya tomada en el Challenge 4 (RFC-001), no algo que este challenge vaya a
  revertir — el riesgo residual sería "aceptamos que un UUID filtrado por otro canal da acceso
  completo a esa cita", con la mitigación de que sea 404 en vez de 403 ante cruces de tenant.
- Amenaza #6 (S3 presigned URLs) no aplica todavía — no hay riesgo residual que firmar hasta que
  exista la Fase 2.

| Riesgo | Firmado por | Fecha | Fecha de revisión |
|---|---|---|---|
| *(pendiente)* | | | |

---

## Preguntas abiertas para el humano

1. ¿Se acepta el riesgo residual de la amenaza #3 (acceso por posesión de UUID) tal cual, o el
   Challenge 5 es el momento de requerir autenticación de paciente (rompería RFC-001 del Challenge
   4 y el flujo de reserva sin cuenta)?
2. La amenaza #17 (payloads `Json` sin esquema validado) — ¿se prioriza escribir el contrato de
   eventos versionado (AsyncAPI o similar) como parte de la Fase 1, antes de tocar código en la
   Fase 3, o se acepta seguir derivándolo del código como se hizo en `docs/baseline-challenge-4.md`?
3. Amenaza #7 (acceso directo de plataforma a la DB) — ¿el diseño de AWS objetivo (ADR-005/009)
   contempla bloquear el acceso directo a RDS incluso para el propio equipo de ingeniería, o solo
   para "soporte" en el sentido de atención a clientes?
4. Contenido real de `Appointment.cancellationReason` (amenaza #16) — ver pregunta ya abierta en
   `docs/baseline-challenge-4.md`, se repite aquí porque determina la severidad final de esta fila.
