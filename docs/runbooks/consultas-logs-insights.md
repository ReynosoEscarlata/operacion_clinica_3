# Catálogo de consultas — CloudWatch Logs Insights

No es una alarma — es la referencia de queries que los demás runbooks enlazan para investigar un
incidente. Log groups: `/clinica/<servicio>` (uno por cada uno de los 6 procesos, ver
`infra/lib/constructs/clinic-service.ts`).

## Por `requestId` (seguir una request a través de un servicio)

```
fields @timestamp, @message
| filter requestId = "<request-id>"
| sort @timestamp asc
```

## Por `traceId` (saltar de una alarma a la traza completa en X-Ray)

```
fields @timestamp, service, @message
| filter traceId = "<trace-id>"
| sort @timestamp asc
```

Con el `traceId`, abrir la consola de X-Ray → Traces → pegar el ID para ver el mapa de servicio
completo de esa request (gateway → servicio(s) → downstream síncrono si aplica).

## Por `tenantId` (drill-down de negocio o de costo)

```
fields @timestamp, service, route, statusCode
| filter tenantId = "<tenant-id>"
| stats count(*) by route
```

Volumen de requests por tenant (insumo del reporte de costo por tenant,
`docs/cost/reporte-costo-por-tenant.md`):
```
fields tenantId
| filter ispresent(tenantId)
| stats count(*) as requests by tenantId
| sort requests desc
```

## Acceso cross-tenant (forense — ver `alarma-acceso-cross-tenant.md`)

```
filter event = 'cross_tenant_access_denied'
| fields @timestamp, actorSub, actorRole, actorTenantId, resourceTenantId, resource, resourceId, requestId, traceId
| sort @timestamp desc
```

Todas las requests de un actor específico en la ventana del incidente (para el criterio
bug-vs-abuso: ¿un solo `resourceId` repetido, o muchos distintos en poco tiempo?):
```
filter actorSub = "<actor-sub>"
| fields @timestamp, service, route, statusCode, requestId
| sort @timestamp asc
```

## Denegaciones de autorización (RBAC)

```
filter event = 'authz_denied'
| stats count(*) by actorRole, permission
```

## Error rate / latencia por servicio (drill-down técnico, complementa el widget agregado)

```
filter Service = "<servicio>"
| stats sum(ErrorCount) as errores, count(*) as total, avg(RequestLatency) as latenciaPromedio by bin(5m)
```

## Slow queries de Postgres (si `log_min_duration_statement` está activo, ver `alarma-rds.md`)

```
fields @timestamp, @message
| filter @message like /duration:/
| sort @timestamp desc
```

**Cuidado con PII**: si `log_min_duration_statement` incluye literales de la query, esta consulta
puede exponer datos sensibles en el resultado — restringir el acceso a esta query específica al
mismo nivel que el acceso a la base de datos de producción (ver ADR-017, sección "cosas a
monitorear").
