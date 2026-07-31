# ADR-018: Cambio de región a us-east-1 (reemplaza ADR-010)

**Fecha:** 2026-07-31
**Estado:** Aceptado (2026-07-31)
**Decisor(es):** Ricardo Reynoso

## Contexto

ADR-010 (Aceptado el 2026-07-29) decidió `mx-central-1` para los tres entornos, condicionado a
verificar disponibilidad de los 11 servicios gestionados que este proyecto necesita —
verificación que en ese momento se hizo contra el catálogo de precios publicado, no contra una
cuenta AWS real (`docs/cost/precios-aws-consultados.md` lo deja explícito: "pricing publicado es
evidencia fuerte pero no 100% concluyente de disponibilidad operativa completa").

Al preparar el primer despliegue real de prueba (Fase 2, `Clinica-dev-Foundation` +
`Clinica-dev-Network` + `Clinica-dev-Cost` en una cuenta sandbox), Ricardo confirmó que la
región efectivamente disponible para esa cuenta es `us-east-1`. `mx-central-1` es una región de
"opt-in" de AWS (como toda región lanzada después de marzo de 2019) — no está habilitada por
default en una cuenta nueva, y habilitarla es un paso adicional fuera del alcance de "probar
rápido y barato" que motivó este despliegue.

## Opciones consideradas

1. **Mantener `mx-central-1`, habilitar la región en la cuenta sandbox primero.**
   - Pros: no reabre ADR-010; residencia de datos de salud en México desde el día 1, sin
     necesidad de justificar transferencia internacional en el aviso de privacidad.
   - Contras: agrega un paso de habilitación de región (y su propia verificación de qué recursos
     de IAM/Organizations puede tocar) antes de poder ejecutar la prueba mínima que se pidió;
     pospone la prueba, no la simplifica.
2. **Cambiar a `us-east-1` para los tres entornos.** (Elegida — ya evaluada como Opción 2 en
   ADR-010, con los mismos pros/contras que se documentan ahí.)
   - Pros: región disponible de inmediato en la cuenta real; sin gestión de opt-in; coincide con
     la región que ADR-010 ya identificaba como la más madura y barata de las tres evaluadas.
   - Contras: implica transferencia internacional de datos de salud (dato sensible bajo LFPDPPP)
     — requiere justificación de compliance explícita en el aviso de privacidad y, para un
     despliegue de producción real, mecanismos de transferencia (cláusulas contractuales o
     equivalente) que este ADR no resuelve — queda como pendiente explícito.
3. **`us-west-2`.** — descartada por el mismo motivo que en ADR-010: no ofrece ninguna ventaja
   sobre `us-east-1` para este proyecto, y `us-east-1` es la región que efectivamente está
   disponible en la cuenta sandbox usada para validar esto.

## Decisión

Elegimos la **Opción 2: `us-east-1`**, para los tres entornos (`dev`, `staging`, `prod`) —
`infra/config/environments.ts` deja de tener una región distinta por entorno explícitamente
condicionada; los tres comparten `us-east-1`. Motivo práctico, no técnico: es la región
efectivamente disponible en la cuenta usada para el primer despliegue de prueba, sin el paso
adicional de habilitar `mx-central-1` como región opt-in.

## Consecuencias

- **Positivas:** desbloquea el despliegue de prueba mínimo (`Foundation` + `Network` + `Cost`)
  sin pasos previos de configuración de cuenta; simplifica `cost-stack.ts` (el pin explícito a
  `us-east-1` para Budgets/Cost Anomaly Detection, necesario porque esos servicios no tienen
  endpoint fuera de esa región, ahora coincide con la región del resto de la infra — el pin queda
  igual en el código por claridad, pero deja de ser una excepción real).
- **Negativas / tradeoffs:** los datos de salud de pacientes mexicanos ahora implican
  transferencia internacional (a EE. UU.) bajo la LFPDPPP. **Pendiente, no resuelto por este
  ADR:** el aviso de privacidad debe declarar explícitamente esta transferencia (hecho en
  `docs/compliance/aviso-de-privacidad.md` como parte de este mismo cambio); un despliegue de
  producción real con datos de pacientes reales necesitaría además el mecanismo de transferencia
  formal (cláusulas contractuales tipo o equivalente) que este ADR no cubre — marcado como
  pregunta abierta.
- **Cosas a monitorear:** si en algún momento se habilita `mx-central-1` en la cuenta de
  producción y se quiere volver a residencia de datos en México, este ADR debería reemplazarse a
  su vez (mismo patrón: nuevo ADR, no editar este). Revisar `docs/cost/cost-model.md` y
  `docs/cost/precios-aws-consultados.md` — sus cifras están calculadas sobre `mx-central-1` y ya
  no reflejan el entorno real; no se actualizaron como parte de este ADR (alcance: solo la
  región, no todo el cost model).

## Referencias
- `docs/adr/ADR-010-region-residencia-datos.md` (decisión original, Opción 2 de esa comparativa
  es la que este ADR termina eligiendo).
- `docs/compliance/aviso-de-privacidad.md` (transferencia internacional declarada como parte de
  este cambio).
- `claude/PLAN-challenge-5-plataforma-para-todos.md`, sección 2 (D4): "Alternativa pragmática:
  `us-east-1` con la justificación de compliance escrita" — anticipaba exactamente este
  escenario.
