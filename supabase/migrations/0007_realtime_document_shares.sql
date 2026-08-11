-- =====================================================================
-- Tiempo real: signature_fields, signatures y documents ya estaban en la
-- publicación supabase_realtime. Falta document_shares para que el dueño
-- vea aparecer a un invitado (por link o por correo) sin recargar.
-- =====================================================================

alter publication supabase_realtime add table document_shares;
