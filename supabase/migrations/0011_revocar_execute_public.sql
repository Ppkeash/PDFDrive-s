-- =====================================================================
-- Remate de 0010: las funciones seguían siendo llamables sin sesión.
--
-- En 0010 se revocó EXECUTE "from anon" y no sirvió de nada: Postgres
-- concede EXECUTE a PUBLIC al crear una función, y `anon` lo hereda por ahí.
-- Comprobado después de aplicar 0010: /rest/v1/rpc/has_document_access
-- seguía respondiendo 200 sin sesión.
--
-- Hay que quitarlo de PUBLIC y volver a darlo solo a quien lo necesita.
-- `authenticated` sí lo necesita: estas funciones se evalúan dentro de las
-- políticas RLS con los permisos de quien hace la consulta, así que sin
-- EXECUTE se rompe el acceso a los documentos.
-- =====================================================================

revoke all on function can_edit_document(uuid)      from public;
revoke all on function can_sign_document(uuid)      from public;
revoke all on function document_role(uuid)          from public;
revoke all on function has_document_access(uuid)    from public;
revoke all on function is_document_owner(uuid)      from public;
revoke all on function shares_document_with(uuid)   from public;
revoke all on function current_email()              from public;

grant execute on function can_edit_document(uuid)     to authenticated, service_role;
grant execute on function can_sign_document(uuid)     to authenticated, service_role;
grant execute on function document_role(uuid)         to authenticated, service_role;
grant execute on function has_document_access(uuid)   to authenticated, service_role;
grant execute on function is_document_owner(uuid)     to authenticated, service_role;
grant execute on function shares_document_with(uuid)  to authenticated, service_role;
grant execute on function current_email()             to authenticated, service_role;

-- Las de trigger no las llama nadie por RPC: el disparador las ejecuta por su
-- cuenta, sin mirar estos permisos.
revoke all on function handle_new_user()     from public;
revoke all on function link_pending_shares() from public;
