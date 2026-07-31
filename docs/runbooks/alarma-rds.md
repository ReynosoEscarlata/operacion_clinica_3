# Runbook — RDS (`clinica-<env>-rds-<servicio>-cpu`, `-free-storage`, `-conexiones`, `-dbload`)

**Alcance:** 4 alarmas por cada una de las 5 instancias RDS (`infra/lib/stacks/database-stack.ts`) —
20 alarmas en total. Notifica a `clinica-<env>-operational-alerts`.

**Umbral de conexiones (`clinica-<env>-rds-<servicio>-conexiones`) NO VERIFICADO**: `max_connections`
real de `db.t4g.micro` es una fórmula sobre memoria disponible
(`LEAST({DBInstanceClassMemory/9531392},5000)`), no una constante fija — el umbral configurado en
`infra/config/environments.ts` (`maxConnectionsAlarmThreshold`) es un valor conservador de arranque,
no el número real confirmado. Verificar con `SHOW max_connections;` contra una instancia desplegada
antes de confiar en este umbral para decisiones de capacidad.

**Nunca ejecutado por Claude Code.**

---

## Síntoma

Una de cuatro señales por instancia RDS:

- **CPU** sobre 80% por 3 períodos de 5 minutos.
- **Free storage** bajo 10% del almacenamiento asignado.
- **Conexiones activas** sobre el umbral configurado por 3 períodos.
- **DBLoad** (Performance Insights, ya habilitado) sobre 2 (el conteo de vCPUs de `db.t4g.micro`) por
  3 períodos — señal agregada de que la instancia está saturada de CPU/IO/locks, más confiable que
  CPU sola para detectar contención real.

## Diagnóstico

1. Identificar la instancia por el nombre de la alarma (`rds-<servicio>-*`).
2. **CPU/DBLoad altos**: abrir Performance Insights de esa instancia en la consola de RDS — el
   desglose "Top SQL" muestra qué queries concentran el load. Cruzar con
   `consultas-logs-insights.md` (slow queries) si `log_min_duration_statement` está activo.
3. **Conexiones altas**: revisar si es un pico de tráfico legítimo o una fuga de conexiones (un
   servicio que no cierra transacciones/clientes Prisma correctamente) —
   `SELECT count(*), state FROM pg_stat_activity WHERE datname = '<servicio>_db' GROUP BY state;`
   contra la instancia. Muchas conexiones en `idle in transaction` es la señal clásica de fuga.
4. **Free storage bajo**: revisar si es crecimiento orgánico esperado (más tenants, más citas) o
   una tabla creciendo sin control (ej. logs de aplicación escritos en una tabla en vez de
   CloudWatch, o `AuditLog`/`DeadLetterEntry` sin política de retención aplicándose — ver ADR-016).

## Decisión

- **CPU/DBLoad alto con una query identificable** → optimización de query/índice, no cambio de
  infraestructura.
- **CPU/DBLoad alto sin query dominante, distribuido** → la instancia está subdimensionada para el
  tráfico real — evaluar subir de tamaño en `infra/config/environments.ts` (cambio de config,
  requiere aprobación humana antes de aplicar en prod).
- **Conexiones altas por fuga** → bug de aplicación (conexión/transacción no cerrada) — no escalar
  el límite de conexiones como parche, arreglar la fuga.
- **Conexiones altas por tráfico legítimo sostenido** → evaluar aumentar el pool de conexiones de
  Prisma (`connection_limit` en `DATABASE_URL`) junto con el tamaño de instancia si corresponde.
- **Free storage bajo por crecimiento sin control** → aplicar la política de retención de ADR-016
  al tipo de dato correspondiente antes de escalar almacenamiento como parche.

## Pasos

```sql
-- Conexiones activas por estado (fuga vs. tráfico legítimo):
SELECT count(*), state FROM pg_stat_activity WHERE datname = '<servicio>_db' GROUP BY state;

-- Queries de larga duración en curso (>30s):
SELECT pid, now() - query_start AS duration, query
FROM pg_stat_activity
WHERE state != 'idle' AND now() - query_start > interval '30 seconds'
ORDER BY duration DESC;
```

Si hay que matar una query colgada (último recurso, no rutina):
```sql
SELECT pg_terminate_backend(<pid>);
```

## Verificación

- Las 4 métricas vuelven a rango normal por al menos el período de evaluación de cada alarma.
- Si se mató una query colgada, confirmar que el servicio dueño no quedó en un estado inconsistente
  (revisar sus propios logs/alarmas de error rate inmediatamente después).

## Post-mortem

Si la causa fue una fuga de conexiones, el fix debe incluir un test de integración que reproduzca
el patrón (ej. una transacción que lanza sin `finally`/cleanup) y confirme que el pool vuelve a su
tamaño esperado después. Si fue un ajuste de sizing, documentar en `infra/README.md` con el dato
real que lo justificó (no un número redondeado a ojo).
