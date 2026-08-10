-- Follow-up to 20260809134659_grant_service_role_write.sql: GRANT/REVOKE are
-- DCL, not DDL, so Supabase's automatic PostgREST-reload event trigger (which
-- only fires on DDL: CREATE/ALTER/DROP) does not pick them up on its own.
-- Without this, PostgREST keeps enforcing the *previous* permission state
-- until it happens to reload on its own — which is exactly what caused
-- "permission denied for table content_items" to persist even after the
-- grant migration above had already been applied successfully. Any future
-- migration that adds/changes a GRANT should end with this same line.
notify pgrst, 'reload schema';
