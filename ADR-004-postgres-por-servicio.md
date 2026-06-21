# ADR-004 — Una instancia de Postgres por servicio (no una instancia con BDs separadas)

**Estado:** Aceptado
**Fecha:** 2026-06-20
**Contexto:** `PLAN.md` Fase 1, punto 2: "Docker Compose: gateway + 3 servicios (esqueletos) +
un Postgres por servicio + Redis. Justificar en ADR si se usan instancias separadas o una con
bases separadas."

## Contexto

`RFC-001-bounded-contexts.md` ya decidió que cada uno de los 5 servicios (Auth, Appointments,
Doctors, Payments, Notifications) tiene "BD propia". Lo que falta decidir es la forma concreta en
Docker Compose / CI: ¿un contenedor Postgres por servicio, o un solo contenedor Postgres con 5
bases de datos (`CREATE DATABASE` separada por servicio)?

Esto es una decisión de infraestructura, no una decisión de bounded context (no está sujeta a la
regla #1 del plan que exige mi aprobación previa) — es una elección de cómo materializar algo ya
aprobado.

## Decisión

**Una instancia de contenedor Postgres por servicio** (5 contenedores `postgres:16-alpine`
independientes, cada uno con su propio volumen), en lugar de una instancia compartida con 5
bases de datos.

## Opciones consideradas

**Opción A (elegida) — Instancias separadas.**
- Cada servicio define su propio contenedor Postgres en `docker-compose.yml`, con su propio
  volumen, credenciales y `DATABASE_URL`.
- Trade-offs: consume más memoria en desarrollo local (5 contenedores Postgres en vez de 1), pero:
  - Refleja fielmente lo que pasará en producción (cada servicio se despliega y escala por
    separado — regla del plan de deploy independiente).
  - Hace literalmente imposible que un servicio haga un `SELECT` cross-schema accidental contra
    la BD de otro servicio "porque está ahí" — con una instancia compartida, un desarrollador
    apurado puede agregar una conexión a otra base en el mismo cluster sin que nada lo impida a
    nivel de infraestructura. Con instancias separadas, ni siquiera hay red/credenciales para
    hacerlo sin querer.
  - El riesgo de "estado compartido sutil" (sección 4 de `PLAN.md`, primer ítem) se reduce a nivel
    de infraestructura, no solo de disciplina de código.
  - Permite reproducir en CI exactamente la topología de producción: un workflow que solo levanta
    el Postgres de su propio servicio (vía `paths` filters), sin depender de que los demás existan.

**Opción B (descartada) — Una instancia, 5 bases de datos separadas.**
- Más liviano en recursos de desarrollo (1 contenedor en vez de 5).
- Se descarta porque: (a) en Postgres, distintas bases de datos en la misma instancia *pueden*
  consultarse entre sí vía `dblink`/`postgres_fdw` si alguien lo habilita — la barrera es de
  convención, no física; (b) un único contenedor caído tira las 5 bases a la vez, lo que
  contradice el objetivo de "tirar un servicio no rompe a los demás" aplicado también a su
  capa de datos; (c) no refleja la topología real de producción, lo que puede ocultar problemas
  de configuración (connection strings, pooling por servicio) hasta que ya esté en producción.

## Consecuencias

- `docker-compose.yml` crece a 5 servicios Postgres adicionales (`postgres-auth`,
  `postgres-appointments`, `postgres-doctors`, `postgres-payments`, `postgres-notifications`),
  cada uno en su propio puerto de host para poder conectarse individualmente en desarrollo.
- Redis **no** se duplica: es el broker de eventos compartido por diseño (ver C4,
  `ADR-001-sync-vs-async.md`) — duplicarlo no tendría sentido porque su propósito es justamente
  ser el canal común entre servicios, a diferencia de una base de datos relacional que representa
  estado propio de un dominio.
- El consumo de memoria en desarrollo local sube; si esto resulta un problema práctico en la
  máquina de desarrollo, se puede revisar este ADR más adelante (no es una decisión irreversible),
  pero se prioriza la fidelidad con producción y la prevención de acoplamiento accidental por
  sobre el ahorro de recursos en esta etapa.
