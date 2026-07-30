# ADR-008: Herramienta de IaC (CDK vs. Terraform)

**Fecha:** 2026-07-29
**Estado:** Aceptado (2026-07-29)
**Decisor(es):** Ricardo Reynoso

## Contexto

Hoy no existe ninguna IaC en el repo (`infra/` solo tiene configuración de Prometheus/Grafana,
confirmado en `docs/baseline-challenge-4.md`, Supuesto S7). Todo el stack es TypeScript/Node.js
(los 5 servicios, el gateway, el panel admin en React). La elección de herramienta de IaC no
afecta el código de aplicación, pero sí quién puede mantenerla y con qué velocidad.

## Opciones consideradas

1. **AWS CDK en TypeScript** — mismo lenguaje que el resto del monorepo.
   - Pros: sin cambio de contexto de lenguaje para quien ya mantiene los servicios; permite
     compartir tipos/constantes entre la app y la infra si algún día hace falta (ej. nombres de
     colas, de streams); `cdk synth`/`cdk diff` dan feedback rápido sin aplicar cambios.
   - Contras: abstrae CloudFormation debajo, lo que a veces dificulta depurar errores de bajo
     nivel; el ecosistema de constructs de terceros es más pequeño que el de módulos de Terraform.
2. **Terraform (HCL)** — el estándar de facto multi-cloud.
   - Pros: ecosistema enorme de módulos reutilizables (Registry de Terraform); portable a otros
     clouds si algún día hiciera falta; `terraform plan` es un estándar ampliamente entendido fuera
     de este equipo.
   - Contras: introduce un lenguaje/toolchain nuevo (HCL) que nadie en el proyecto usa hoy; el
     objetivo de este challenge es demostrar arquitectura, no aprender un DSL nuevo desde cero.
3. **Pulumi (TypeScript)** — alternativa a CDK con el mismo lenguaje pero multi-cloud.
   - Pros: mismo beneficio de lenguaje único que CDK, con la portabilidad de Terraform.
   - Contras: comunidad y adopción menor que CDK o Terraform puro para AWS específicamente;
     introduce una dependencia de un proveedor de state management (Pulumi Cloud) o gestión propia
     de backend, complejidad adicional no justificada para este alcance.

## Decisión

Elegimos la **Opción 1: AWS CDK en TypeScript**. Ratificada por Ricardo el 2026-07-29 sobre la
inclinación de Fase 0.

## Consecuencias

- **Positivas:** cero fricción de lenguaje; el mismo `tsconfig`/tooling de lint/format del
  monorepo (`eslint`, `prettier`) puede extenderse a `infra/`.
- **Negativas / tradeoffs:** menor portabilidad fuera de AWS si algún día se considerara
  multi-cloud (fuera del alcance de este challenge, ver stretch goals).
- **Cosas a monitorear:** tamaño de los stacks de CDK a medida que crecen (Fase 2 ya propone
  separar por dominio: `network`, `database`, `compute`, `messaging`, `storage`, `identity`,
  `edge`, `observability` — evitar un único stack monolítico que tarde minutos en sintetizar).

## Referencias
- `claude/PLAN-challenge-5-plataforma-para-todos.md`, Fase 2 (estructura esperada de `infra/`)
