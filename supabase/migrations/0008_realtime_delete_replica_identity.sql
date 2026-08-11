-- =====================================================================
-- Realtime + RLS + DELETE: para evaluar la política de seguridad en un
-- borrado, Postgres necesita mandar la fila completa que se borró, no solo
-- su id. Por default solo manda la primary key (REPLICA IDENTITY DEFAULT)
-- -- Realtime no puede confirmar si el suscriptor tenía permiso de verla y
-- descarta el evento en silencio.
--
-- Esto explicaba por qué "deshacer firma" no se reflejaba en tiempo real en
-- la pestaña de otro firmante: el DELETE en `signatures` nunca llegaba.
-- Mismo problema aplica a `signature_fields` (quitar campo) y
-- `document_shares` (quitar acceso).
-- =====================================================================

alter table signatures replica identity full;
alter table signature_fields replica identity full;
alter table document_shares replica identity full;
