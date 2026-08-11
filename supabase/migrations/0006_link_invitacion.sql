-- =====================================================================
-- Link de invitación: para no invitar de a uno, el dueño genera un enlace
-- único por documento que cualquiera puede abrir (WhatsApp, correo, lo que
-- sea) y queda como firmante. Se reutiliza para todos los que entren por
-- ahí -- no es de un solo uso -- y deja de servir solo cuando el dueño lo
-- revoca o cuando el documento se cierra (`status = 'firmado'`): en ese
-- punto ya no hay nada que firmar.
-- =====================================================================

alter table documents add column if not exists invite_token text unique;
