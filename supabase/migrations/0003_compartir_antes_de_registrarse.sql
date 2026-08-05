-- =====================================================================
-- Compartir con alguien que todavía no tiene cuenta.
--
-- shareDocument resolvía el user_id consultando profiles en el momento de
-- compartir. Si la persona aún no se había registrado, el user_id quedaba
-- nulo de forma permanente, y como has_document_access solo compara
-- user_id = auth.uid(), nunca llegaba a ver el documento — ni siquiera
-- después de crear su cuenta. El caso normal (invitar a alguien y que se
-- registre luego) estaba roto.
--
-- Se resuelve vinculando la invitación en cuanto nace el perfil.
-- =====================================================================

-- Los emails se comparan sin distinguir mayúsculas: quien invita escribe a
-- mano y "Ana@x.com" debe encontrar a "ana@x.com".
create or replace function public.link_pending_shares()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update document_shares
     set user_id = new.id
   where user_id is null
     and lower(email) = lower(new.email);
  return new;
end;
$$;

drop trigger if exists on_profile_created_link_shares on profiles;
create trigger on_profile_created_link_shares
  after insert on profiles
  for each row execute function public.link_pending_shares();

-- Vincular las invitaciones que quedaron colgando antes de este arreglo.
update document_shares s
   set user_id = p.id
  from profiles p
 where s.user_id is null
   and lower(s.email) = lower(p.email);

-- Evita duplicados por diferencias de mayúsculas en el mismo documento.
create unique index if not exists document_shares_doc_email_unico
  on document_shares (document_id, lower(email));
