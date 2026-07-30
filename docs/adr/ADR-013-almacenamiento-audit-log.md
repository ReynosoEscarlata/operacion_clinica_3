# ADR-013: Almacenamiento del audit log e inmutabilidad

**Fecha:** 2026-07-29
**Estado:** Aceptado (2026-07-29)
**Decisor(es):** Ricardo Reynoso

## Contexto

Hoy no existe ningún audit log de acceso a PII (confirmado en `docs/security/threat-model.md`,
amenaza #9 — "no existe hoy"). El patrón `AppointmentEvent`/`OutboxEvent` que ya existe en el
repo registra *cambios de estado de negocio*, no *accesos a datos* — son conceptos distintos que
no deben confundirse: un audit log de compliance debe registrar también lecturas (ej. un
`platform_support` consultando el historial de un paciente), no solo escrituras.

## Opciones consideradas

1. **Tabla append-only en cada Postgres de servicio** (sin permisos de `UPDATE`/`DELETE` para el
   rol de aplicación) + exportación periódica a S3 con Object Lock en modo compliance.
   - Pros: reutiliza la infraestructura que ya existe (Postgres por servicio); el patrón de "rol
     de aplicación sin ciertos privilegios" ya es familiar en este repo (RLS de ADR-006 usa la
     misma idea de restringir privilegios del rol, no solo de la aplicación).
   - Contras: un compromiso de las credenciales de Postgres con un rol mal configurado (ej. uno
     con `BYPASSRLS` por error) podría alterar la tabla si no se refuerza también a nivel de IAM/DB
     con un rol dedicado sin ningún privilegio de escritura salvo `INSERT`.
2. **S3 Object Lock (modo compliance) como fuente de verdad única**, sin tabla en Postgres.
   - Pros: inmutabilidad garantizada por la plataforma (AWS), no por convención de permisos de
     rol; más simple de auditar externamente ("esto vive en S3 con retención legal, punto").
   - Contras: consultar el audit log de un tenant específico (para mostrárselo a un `clinic_admin`,
     requisito de la Fase 5) es más lento/costoso desde S3 que desde una tabla indexada; requiere
     construir un mecanismo de consulta (ej. Athena) que hoy no existe en el stack.
3. **Tabla append-only + export a S3 Object Lock + encadenamiento por hash** (cada registro incluye
   el hash del anterior, permitiendo detectar manipulación) — combinación de 1 y 2, más una
   verificación criptográfica de integridad.
   - Pros: consulta rápida desde Postgres para la UI de auditoría del tenant, inmutabilidad legal
     desde S3 Object Lock, y detección de manipulación incluso si alguien lograra escribir
     directamente en la tabla (el hash del registro siguiente no cuadraría).
   - Contras: la escritura garantizada del audit log (si falla, la operación de negocio debe
     fallar también — regla explícita de la Fase 5) ahora depende de tres pasos exitosos (insert +
     hash + eventual export), más superficie de fallo que las opciones 1 o 2 solas.

## Decisión

Elegimos la **Opción 1: tabla append-only por servicio** (sin privilegios de `UPDATE`/`DELETE`
para el rol de aplicación) **+ exportación periódica a S3 con Object Lock en modo compliance**,
sin el encadenamiento por hash de la Opción 3. Ricardo priorizó menor superficie de fallo (la
escritura garantizada depende de un solo paso crítico, el insert en Postgres, no de tres) sobre la
capa adicional de detección criptográfica de manipulación.

## Consecuencias

- **Positivas:** reutiliza infraestructura ya existente (Postgres por servicio); menos pasos
  críticos en el camino de escritura garantizada ("si el audit log falla, la operación falla") que
  la Opción 3 — solo el insert a la tabla debe tener éxito de forma síncrona, el export a S3 puede
  ser asíncrono sin poner en riesgo la operación de negocio.
- **Negativas / tradeoffs:** sin encadenamiento por hash, si alguien lograra escribir directamente
  en la tabla con credenciales de un rol mal configurado (ej. uno con privilegios de `UPDATE` por
  error de IAM), **no habría forma criptográfica de detectar la manipulación** — la inmutabilidad
  depende enteramente de que los privilegios de rol estén bien configurados y no de una
  verificación adicional. Esto es exactamente el mismo tipo de riesgo que la amenaza #9 del threat
  model (borrado/alteración del audit log) — se acepta el trade-off, pero refuerza la importancia
  de que el rol de aplicación nunca tenga `UPDATE`/`DELETE` sobre esta tabla, verificado con tests.
- **Cosas a monitorear:** toda ruta que toque PII (según `docs/baseline-challenge-4.md` sección 2)
  debe escribir al audit log antes de responder — cambio transversal a los 5 servicios; latencia
  agregada por request por la escritura síncrona (medir p95 en Fase 6); privilegios del rol de
  aplicación sobre la tabla de audit log (revisar en cada cambio de infraestructura que no se
  otorgue `UPDATE`/`DELETE` por error).

## Referencias
- `docs/security/threat-model.md`, amenazas #7 y #9
- `claude/PLAN-challenge-5-plataforma-para-todos.md`, Fase 5, punto 1
