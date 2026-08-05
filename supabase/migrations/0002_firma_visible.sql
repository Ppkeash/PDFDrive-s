-- =====================================================================
-- Firma visible: consecuencias del cambio de modelo de firma.
-- =====================================================================

-- Un campo de firma no puede firmarse dos veces. La edge function ya lo
-- comprueba, pero la garantía debe estar también en la base: dos peticiones
-- simultáneas podrían colarse entre la lectura y la escritura.
create unique index if not exists signatures_field_unico
  on signatures (field_id)
  where field_id is not null;

-- ---------------------------------------------------------------------
-- Arreglo de datos: documentos firmados con la lógica anterior.
--
-- El cálculo antiguo era:
--     complete = fieldCount > 0 && sigCount >= fieldCount
-- así que un documento sin campos nunca llegaba a 'firmado' por muchas
-- firmas que tuviera, y se quedaba en 'en_firma' de forma permanente.
--
-- Esos documentos sí llevan un sello PAdES real, así que corresponde
-- marcarlos como cerrados. La verificación criptográfica es ahora la que
-- dictamina si el sello es válido, no este estado.
-- ---------------------------------------------------------------------
update documents d
set status = 'firmado'
where d.status = 'en_firma'
  and d.signed_path is not null
  and exists (select 1 from signatures s where s.document_id = d.id)
  and not exists (
    select 1
    from signature_fields f
    where f.document_id = d.id
      and not exists (
        select 1 from signatures s2 where s2.field_id = f.id
      )
  );
