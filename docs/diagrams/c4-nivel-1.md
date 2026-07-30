# C4 Nivel 1 — Diagrama de Contexto

**Fase:** 1 del `claude/PLAN-challenge-5-plataforma-para-todos.md`
**Referencia:** `docs/architecture/C4-nivel2-contenedores.md` (Challenge 4, contenedores actuales
sin capa AWS), `docs/rfc/RFC-003-tenancy.md`, `docs/rfc/RFC-004-rbac.md`.

Este es el primer C4 de nivel 1 del proyecto — el Challenge 4 solo produjo nivel 2. Muestra la
plataforma como una caja única, los tipos de usuario (incluyendo los nuevos roles de plataforma
que no existen hoy) y los sistemas externos. Los elementos marcados **"(propuesto)"** no existen
todavía en el sistema real; reflejan lo que este challenge se propone construir.

```mermaid
C4Context
    title Clínica Scheduler — Contexto (SaaS multi-tenant, post-Challenge 5)

    Person(patient, "Paciente", "Reserva y cancela su propia cita. Sin cuenta — identificado por posesión del UUID de la cita.")
    Person(doctor, "Doctor", "Ve y gestiona sus propias citas y disponibilidad. (propuesto: rol formal, hoy es STAFF sin distinción)")
    Person(receptionist, "Recepcionista", "Gestiona citas y pacientes de su clínica. (propuesto: rol formal)")
    Person(clinicAdmin, "Admin de clínica\n(clinic_owner / clinic_admin)", "Administra usuarios, doctores y configuración de su propia clínica. (propuesto: los dos planos de autorización de RFC-004)")
    Person(platformOps, "Equipo de plataforma\n(platform_admin / platform_support)", "Opera el SaaS. Acceso cross-tenant con auditoría reforzada y justificación obligatoria. (propuesto: no existe ningún concepto de esto hoy)")

    System(clinica, "Clínica Scheduler (SaaS multi-tenant)", "Reserva de citas, cobro online, notificaciones, panel administrativo — para múltiples clínicas independientes")

    System_Ext(stripe, "Stripe", "Procesador de pagos externo (ya integrado)")
    System_Ext(resend, "Resend", "Proveedor de email externo (ya integrado)")
    System_Ext(cognito, "AWS Cognito", "Identidad y emisión de JWT con tenant_id/roles como claims (propuesto, Fase 2/4 — hoy Auth emite sus propios JWT)")

    Rel(patient, clinica, "Reserva/cancela cita, ve detalle", "HTTPS")
    Rel(doctor, clinica, "Ve/gestiona sus citas y disponibilidad", "HTTPS + JWT")
    Rel(receptionist, clinica, "Gestiona citas/pacientes de su clínica", "HTTPS + JWT")
    Rel(clinicAdmin, clinica, "Administra su clínica (usuarios, doctores, config)", "HTTPS + JWT")
    Rel(platformOps, clinica, "Soporte/operación cross-tenant, auditado", "HTTPS + JWT (pool de plataforma, ver ADR-011)")

    Rel(clinica, stripe, "Cobra citas, emite refunds", "HTTPS")
    Rel(clinica, resend, "Envía notificaciones por email", "HTTPS")
    Rel(clinica, cognito, "Autentica usuarios, verifica JWT", "HTTPS (propuesto)")
```

## Lectura del diagrama

- **Los tres roles de tenant granulares** (`doctor`, `receptionist`, distinción
  `clinic_owner`/`clinic_admin`) son propuestos por RFC-004 — hoy el sistema solo distingue
  `ADMIN`/`STAFF` sin este nivel de detalle. Este diagrama documenta la intención, no el estado
  actual (ver `docs/architecture/C4-nivel2-contenedores.md` para el estado de contenedores real
  del Challenge 4).
- **El equipo de plataforma no existe como concepto hoy.** Es el plano de autorización que RFC-004
  introduce explícitamente para no repetir el error común de SaaS B2B de mezclar "admin de todo"
  con "admin de una clínica".
- **Stripe y Resend ya están integrados** (sin cambios en este challenge) — se muestran para
  completar el contexto, no porque este challenge los toque.
- **Cognito es propuesto.** El sistema de identidad real hoy es `services/auth` con JWT RS256
  propio (ver ADR-011 para la decisión de cuántos user pools usar cuando se migre).
