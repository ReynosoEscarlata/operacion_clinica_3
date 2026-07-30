# ADR-015: Objetivos de DR (RTO/RPO) y estrategia

**Fecha:** 2026-07-29
**Estado:** Aceptado (2026-07-29)
**Decisor(es):** Ricardo Reynoso

## Contexto

Hoy no existe ninguna estrategia de disaster recovery (no hay backups automatizados, no hay
Multi-AZ, no hay ningún entorno en AWS todavía). Este ADR no fija el RTO/RPO final (eso requiere
el RFC-DR completo de la Fase 7, con matriz de dependencias y game days), pero registra las
opciones de estrategia general para calibrar el diseño de la Fase 2 (¿la fundación de
infraestructura se construye ya pensando en warm standby, o se difiere?).

Nota importante ya señalada en el plan maestro: la estrategia de DR es una decisión de presupuesto
disfrazada de decisión técnica — con el rango austero confirmado (~$150-300/mes @10 clínicas),
algunas opciones quedan descartadas de entrada, no por preferencia técnica sino por costo.

## Opciones consideradas

1. **Backup & restore** — snapshots automáticos + PITR, sin infraestructura standby corriendo.
   - Pros: el más barato con diferencia — no se paga por una segunda copia de infraestructura
     activa.
   - Contras: RTO más alto (minutos a horas, según tamaño de la restauración) — no apto para
     servicios donde la indisponibilidad prolongada tiene impacto directo en pacientes (ej.
     `appointments` en horario de atención).
2. **Pilot light** — los componentes críticos (ej. RDS con réplica de lectura en otra AZ/región) 
   existen en modo mínimo, listos para escalar en un incidente.
   - Pros: RTO significativamente menor que backup & restore, costo intermedio.
   - Contras: requiere mantener y probar el proceso de "encender" el resto de la infraestructura
     bajo presión — sin un game day real (Fase 7), un pilot light nunca probado es tan poco
     confiable como no tener DR.
3. **Warm standby** — una copia reducida pero funcional corriendo en todo momento en una AZ/región
   secundaria.
   - Pros: RTO bajo, failover rápido.
   - Contras: duplica buena parte del costo de infraestructura corriendo 24/7 — muy probablemente
     incompatible con el rango de presupuesto austero confirmado, salvo que se aplique solo a los
     componentes de mayor criticidad (ej. solo Appointments+RDS, no los 5 servicios completos).

**Nota de alcance:** este ADR no decide RTO/RPO por clase de servicio (eso es explícitamente del
RFC-DR de la Fase 7, que distingue por ejemplo la API de citas del envío de recordatorios). Lo que
sí conviene fijar ahora es la estrategia general, porque afecta si Multi-AZ se activa desde la
Fase 2 (RDS Multi-AZ) o se difiere.

## Decisión

Elegimos la **Opción 1: backup & restore** como estrategia general de DR — sin infraestructura
standby corriendo, snapshots automáticos + PITR. Ricardo priorizó el costo (compatible con el
presupuesto austero confirmado, ~$150-300/mes @10 clínicas) sobre un RTO más bajo, coherente con
que hoy no hay clínicas reales en producción todavía. La Fase 2 **no** aprovisiona RDS Multi-AZ
por defecto bajo esta decisión — la talla base es Single-AZ, con Multi-AZ como opción a activar
por servicio/entorno si el RFC-DR de la Fase 7 lo justifica para un caso específico.

## Consecuencias

- **Positivas:** costo de infraestructura significativamente menor (RDS Single-AZ, sin duplicar
  cómputo; sin instancias standby corriendo 24/7) — deja margen del presupuesto austero para otros
  componentes (WAF, Secrets Manager, observabilidad).
- **Negativas / tradeoffs:** **RTO alto** (minutos a horas según tamaño de la restauración) — una
  caída de RDS en producción real dejaría el servicio afectado indisponible por ese tiempo, sin
  failover automático. Se acepta como riesgo consciente mientras no haya clínicas reales
  dependiendo del sistema; este ADR debe revisarse explícitamente antes de aceptar el primer
  cliente de producción real.
- **Cosas a monitorear:** el RFC-DR de la Fase 7 debe fijar el RTO/RPO exacto por clase de servicio
  sobre esta base — si algún servicio (ej. `appointments` en horario de atención) resulta
  necesitar un RTO menor al que backup & restore ofrece, ese es el momento de reconsiderar este
  ADR para ese servicio puntual, no para toda la plataforma; probar el proceso de restore
  (game day 2 de la Fase 7) es obligatorio, no opcional, precisamente porque no hay standby que
  compense un backup mal probado.

## Referencias
- `claude/PLAN-challenge-5-plataforma-para-todos.md`, Fase 7 (RFC-disaster-recovery.md completo)
- `docs/cost/precios-aws-consultados.md` (costo de Multi-AZ)
