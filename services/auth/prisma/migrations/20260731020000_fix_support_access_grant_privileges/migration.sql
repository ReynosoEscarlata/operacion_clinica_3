-- Fix (Fase 5): la migración 20260731010000_support_access_grant otorgó
-- explícitamente GRANT SELECT, INSERT a app_role, pero GRANT es aditivo --
-- no revocó el UPDATE/DELETE que app_role ya tenía por la
-- ALTER DEFAULT PRIVILEGES de 20260730171920_add_tenant_id_rls (aplica a
-- toda tabla nueva creada por el mismo rol en schema public). Verificado
-- contra la base de dev: `\dp "SupportAccessGrant"` mostraba
-- `app_role=arwd`, es decir, la tabla NO era append-only pese al comentario
-- de esa migración -- app_role podía actualizar y borrar grants. Este fix
-- revoca explícitamente lo que el default privilege volvió a otorgar.
REVOKE UPDATE, DELETE ON "SupportAccessGrant" FROM app_role;
