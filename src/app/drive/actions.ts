"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

// La RLS de Supabase garantiza que solo el dueño (o quien tenga acceso) pueda
// mutar cada fila; aquí solo orquestamos.

/** Lo que se repite en cada acción del Drive. */
function refrescarDrive() {
  revalidatePath("/drive");
  revalidatePath("/drive/papelera");
}

/**
 * Nombre ya usado por una carpeta hermana.
 *
 * La base no tiene índice único por (padre, nombre) --nunca lo tuvo-- así que
 * sin esto se pueden crear dos "Actas 2026" en el mismo sitio y después no hay
 * forma de distinguirlas. Se comprueba aquí en vez de añadir el índice porque
 * puede haber nombres repetidos de antes, y una migración que falla al crear
 * el índice dejaría la base a medias.
 */
async function nombreOcupadoEntreHermanas(
  supabase: ReturnType<typeof createClient>,
  parentId: string | null,
  name: string,
  exceptoId?: string
) {
  const q = supabase.from("folders").select("id, name");
  const { data } = parentId
    ? await q.eq("parent_id", parentId)
    : await q.is("parent_id", null);

  return (data ?? []).some(
    (f) =>
      f.id !== exceptoId &&
      f.name.trim().toLowerCase() === name.trim().toLowerCase()
  );
}

/** Crea la carpeta y devuelve su id, para poder entrar en ella al terminar. */
export async function createFolder(name: string, parentId?: string | null) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "No autenticado" };

  const limpio = name.trim();
  if (!limpio) return { error: "La carpeta necesita un nombre." };

  const padre = parentId ?? null;
  if (await nombreOcupadoEntreHermanas(supabase, padre, limpio))
    return { error: `Ya hay una carpeta llamada "${limpio}" en este sitio.` };

  const { data, error } = await supabase
    .from("folders")
    .insert({ owner_id: user.id, name: limpio, parent_id: padre })
    .select("id")
    .single();
  if (error) return { error: error.message };

  refrescarDrive();
  return { id: data.id as string };
}

export async function renameFolder(id: string, name: string) {
  const supabase = createClient();

  const limpio = name.trim();
  if (!limpio) return { error: "La carpeta necesita un nombre." };

  const { data: actual, error: errLectura } = await supabase
    .from("folders")
    .select("parent_id")
    .eq("id", id)
    .single();
  if (errLectura) return { error: errLectura.message };

  if (
    await nombreOcupadoEntreHermanas(
      supabase,
      actual.parent_id ?? null,
      limpio,
      id
    )
  )
    return { error: `Ya hay una carpeta llamada "${limpio}" en este sitio.` };

  const { error } = await supabase
    .from("folders")
    .update({ name: limpio })
    .eq("id", id);
  if (error) return { error: error.message };

  refrescarDrive();
  return {};
}

/**
 * Borra la carpeta y sube su contenido un nivel.
 *
 * Antes se borraba la fila a secas y el resto lo decidían las claves foráneas:
 * `folders.parent_id` es `on delete cascade`, así que **todas las subcarpetas
 * desaparecían**, y los documentos de todo el subárbol caían a la raíz
 * (`documents.folder_id` es `on delete set null`). Es decir: borrar una
 * carpeta destruía su organización interna y desparramaba los documentos, tras
 * un `confirm` de una línea que ni lo mencionaba.
 *
 * Ahora el contenido directo se reubica a propósito en la carpeta padre --o en
 * la raíz, si la carpeta estaba arriba-- y solo entonces se borra la fila, ya
 * vacía. Ninguna subcarpeta se pierde y nada aparece donde no se espera.
 */
export async function deleteFolder(id: string) {
  const supabase = createClient();

  const { data: carpeta, error: errLectura } = await supabase
    .from("folders")
    .select("parent_id")
    .eq("id", id)
    .single();
  if (errLectura) return { error: errLectura.message };

  const destino = (carpeta.parent_id as string | null) ?? null;

  const { error: errCarpetas } = await supabase
    .from("folders")
    .update({ parent_id: destino })
    .eq("parent_id", id);
  if (errCarpetas) return { error: errCarpetas.message };

  const { error: errDocs } = await supabase
    .from("documents")
    .update({ folder_id: destino })
    .eq("folder_id", id);
  if (errDocs) return { error: errDocs.message };

  const { error } = await supabase.from("folders").delete().eq("id", id);
  if (error) return { error: error.message };

  refrescarDrive();
  return { destino };
}

export async function moveDocument(id: string, folderId: string | null) {
  return moveDocuments([id], folderId);
}

/** Mover varios: subir veinte documentos y moverlos de a uno no es un flujo. */
export async function moveDocuments(ids: string[], folderId: string | null) {
  if (ids.length === 0) return {};
  const supabase = createClient();
  const { error } = await supabase
    .from("documents")
    .update({ folder_id: folderId })
    .in("id", ids);
  if (error) return { error: error.message };
  refrescarDrive();
  return {};
}

export async function renameDocument(id: string, name: string) {
  const supabase = createClient();
  const limpio = name.trim();
  if (!limpio) return { error: "El documento necesita un nombre." };

  const { error } = await supabase
    .from("documents")
    .update({ name: limpio })
    .eq("id", id);
  if (error) return { error: error.message };
  refrescarDrive();
  return {};
}

export async function softDeleteDocument(id: string) {
  return trashDocuments([id]);
}

export async function trashDocuments(ids: string[]) {
  if (ids.length === 0) return {};
  const supabase = createClient();
  const { error } = await supabase
    .from("documents")
    .update({ deleted_at: new Date().toISOString() })
    .in("id", ids);
  if (error) return { error: error.message };
  refrescarDrive();
  return {};
}

/**
 * Saca un documento de la papelera.
 *
 * Devuelve dónde quedó: si la carpeta en la que estaba se borró mientras el
 * documento estaba en la papelera, la clave foránea ya puso `folder_id` en
 * null y el documento aparece en la raíz. Hay que decirlo, o la persona lo
 * busca donde ya no está.
 */
export async function restoreDocument(id: string) {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("documents")
    .update({ deleted_at: null })
    .eq("id", id)
    .select("folder_id")
    .single();
  if (error) return { error: error.message };
  refrescarDrive();
  return { folderId: (data.folder_id as string | null) ?? null };
}

/**
 * Borrado definitivo: primero los archivos, después la fila.
 *
 * En ese orden a propósito. Si se borra la fila primero y falla el borrado del
 * archivo, queda un objeto en Storage que ya nadie nombra: invisible y
 * imposible de limpiar sin entrar al panel de Supabase. Al contrario, si el
 * archivo se va y la fila se queda, la fila sigue a la vista en la papelera y
 * se puede volver a intentar.
 */
export async function deleteDocumentForever(id: string) {
  const supabase = createClient();

  const { data: doc, error: errLectura } = await supabase
    .from("documents")
    .select("storage_path, signed_path")
    .eq("id", id)
    .single();
  if (errLectura) return { error: errLectura.message };

  if (doc.storage_path)
    await supabase.storage.from("originals").remove([doc.storage_path]);
  if (doc.signed_path)
    await supabase.storage.from("signed").remove([doc.signed_path]);

  const { error } = await supabase.from("documents").delete().eq("id", id);
  if (error) return { error: error.message };

  refrescarDrive();
  return {};
}

type ShareRole = "editor" | "firmante" | "lector";

export async function shareDocument(
  documentId: string,
  email: string,
  role: ShareRole
) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "No autenticado" };

  // Normalizado: quien invita escribe a mano y no debe importar cómo lo teclee.
  const clean = email.trim().toLowerCase();

  // Si ya tiene cuenta se vincula ahora. Si no, la invitación queda pendiente
  // y el trigger link_pending_shares la enlaza en cuanto se registre.
  const { data: profile } = await supabase
    .from("profiles")
    .select("id")
    .ilike("email", clean)
    .maybeSingle();

  const { error } = await supabase.from("document_shares").upsert(
    {
      document_id: documentId,
      email: clean,
      role,
      user_id: profile?.id ?? null,
    },
    { onConflict: "document_id,email" }
  );
  if (error) return { error: error.message };

  await supabase.from("audit_log").insert({
    document_id: documentId,
    actor_id: user.id,
    action: "compartir",
    metadata: { email: clean, role, pendiente: !profile },
  });

  revalidatePath(`/doc/${documentId}`);
  return { pending: !profile };
}

/** Cambia el permiso de alguien que ya tiene acceso. */
export async function updateShareRole(
  documentId: string,
  email: string,
  role: ShareRole
) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "No autenticado" };

  const clean = email.trim().toLowerCase();
  const { error } = await supabase
    .from("document_shares")
    .update({ role })
    .eq("document_id", documentId)
    .eq("email", clean);
  if (error) return { error: error.message };

  await supabase.from("audit_log").insert({
    document_id: documentId,
    actor_id: user.id,
    action: "cambiar_permiso",
    metadata: { email: clean, role },
  });

  revalidatePath(`/doc/${documentId}`);
  return {};
}

/**
 * Quita el acceso. Se llevan por delante los campos de firma que esa persona
 * tuviera pendientes: si se quedaran ahí, nadie podría firmarlos y el documento
 * jamás llegaría a sellarse. Los ya firmados no se tocan — son la prueba.
 */
export async function removeShare(documentId: string, email: string) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "No autenticado" };

  const clean = email.trim().toLowerCase();

  const { data: fields } = await supabase
    .from("signature_fields")
    .select("id, signatures ( id )")
    .eq("document_id", documentId)
    .eq("assigned_email", clean);

  const orphans = (fields ?? [])
    .filter((f) => ((f.signatures as unknown[]) ?? []).length === 0)
    .map((f) => f.id);

  if (orphans.length > 0) {
    await supabase.from("signature_fields").delete().in("id", orphans);
  }

  const { error } = await supabase
    .from("document_shares")
    .delete()
    .eq("document_id", documentId)
    .eq("email", clean);
  if (error) return { error: error.message };

  await supabase.from("audit_log").insert({
    document_id: documentId,
    actor_id: user.id,
    action: "quitar_acceso",
    metadata: { email: clean, campos_eliminados: orphans.length },
  });

  revalidatePath(`/doc/${documentId}`);
  return { removedFields: orphans.length };
}

/**
 * Genera (o renueva) el link único de invitación: quien lo abre queda como
 * firmante, sin tener que invitar por correo uno por uno. Renovarlo invalida
 * el anterior -- es la forma de revocarlo sin tener que "desactivar" nada.
 */
export async function generateInviteLink(documentId: string) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "No autenticado" };

  const token = crypto.randomUUID().replace(/-/g, "");
  const { error } = await supabase
    .from("documents")
    .update({ invite_token: token })
    .eq("id", documentId);
  if (error) return { error: error.message };

  revalidatePath(`/doc/${documentId}`);
  return { token };
}

/** Quita el link: quien ya entró por ahí conserva su acceso, pero el enlace deja de servir. */
export async function revokeInviteLink(documentId: string) {
  const supabase = createClient();
  const { error } = await supabase
    .from("documents")
    .update({ invite_token: null })
    .eq("id", documentId);
  if (error) return { error: error.message };

  revalidatePath(`/doc/${documentId}`);
  return {};
}

/** Da de baja un enlace que todavía no se usó. */
export async function revokeSigningLink(documentId: string, linkId: string) {
  const supabase = createClient();
  const { error } = await supabase
    .from("signing_links")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", linkId)
    .is("used_at", null);
  if (error) return { error: error.message };

  revalidatePath(`/doc/${documentId}`);
  return {};
}

/**
 * Enlace abierto para firmar sin cuenta (migraciones 0017 a 0019).
 *
 * Un solo enlace que se manda al grupo. Quien lo abre escribe su nombre y
 * firma; no hay lista que preparar.
 *
 * El tope lo escoge quien envía al crearlo, y el enlace lleva su propio
 * contador. Deducirlo de los espacios libres del documento tenía un problema:
 * si el documento ya traía recuadros de antes, el enlace admitía más firmas de
 * las que su dueño creía haber autorizado.
 *
 * Vence en horas, no en días: un acta se firma en la reunión o no se firma. Un
 * enlace que sigue vivo dos semanas después es una puerta abierta sin motivo.
 *
 * Tiene un hueco conocido y aceptado: como el nombre es libre, nada impide
 * que la misma persona firme dos veces con nombres distintos, ni que alguien
 * a quien le reenvíen el enlace firme. Queda el rastro -- nombre, IP,
 * navegador, hora -- y la firma se marca como `enlace`, nunca como `cuenta`.
 * Si algún día eso estorba, `signing_link_slots` ya soporta la variante con
 * lista cerrada de nombres.
 *
 * El caso que lo pide: un acta que firman 20 personas que no usan la
 * aplicación. Mandar 20 enlaces distintos no lo hace nadie.
 *
 * La lista es lo que lo sostiene. Un enlace grupal sin lista dejaría que la
 * misma persona firme dos veces con nombres distintos, o que un extraño que
 * lo reciba reenviado se invente un nombre. Con la lista cerrada, para colarse
 * hay que tomar el cupo de alguien concreto -- y esa persona lo nota.
 */
export async function createOpenSigningLink(
  documentId: string,
  cuantasFirmas: number,
  horasDeVigencia = 2
) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "No autenticado" };

  const cupo = Math.round(cuantasFirmas);
  if (!Number.isFinite(cupo) || cupo < 1 || cupo > 200)
    return { error: "El número de firmas no es válido." };

  const horas = Math.min(72, Math.max(1, Math.round(horasDeVigencia)));

  const token = `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, "");
  const expires = new Date(Date.now() + horas * 3_600_000).toISOString();

  const { error } = await supabase.from("signing_links").insert({
    document_id: documentId,
    token,
    kind: "grupal",
    created_by: user.id,
    max_signatures: cupo,
    expires_at: expires,
  });
  if (error) return { error: error.message };

  revalidatePath(`/doc/${documentId}`);
  return { token };
}
