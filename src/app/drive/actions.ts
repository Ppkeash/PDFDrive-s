"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

// La RLS de Supabase garantiza que solo el dueño (o quien tenga acceso) pueda
// mutar cada fila; aquí solo orquestamos.

export async function createFolder(name: string, parentId?: string | null) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "No autenticado" };

  const { error } = await supabase
    .from("folders")
    .insert({ owner_id: user.id, name, parent_id: parentId ?? null });
  if (error) return { error: error.message };
  revalidatePath("/drive");
  return {};
}

export async function renameFolder(id: string, name: string) {
  const supabase = createClient();
  const { error } = await supabase.from("folders").update({ name }).eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/drive");
  return {};
}

/**
 * Borra la carpeta. Los documentos que contenía no se pierden: la clave
 * foránea es `on delete set null`, así que vuelven a la raíz.
 */
export async function deleteFolder(id: string) {
  const supabase = createClient();
  const { error } = await supabase.from("folders").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/drive");
  return {};
}

export async function moveDocument(id: string, folderId: string | null) {
  const supabase = createClient();
  const { error } = await supabase
    .from("documents")
    .update({ folder_id: folderId })
    .eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/drive");
  return {};
}

export async function renameDocument(id: string, name: string) {
  const supabase = createClient();
  const { error } = await supabase
    .from("documents")
    .update({ name })
    .eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/drive");
  return {};
}

export async function softDeleteDocument(id: string) {
  const supabase = createClient();
  const { error } = await supabase
    .from("documents")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/drive");
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
 * El tope no es un número que alguien configure: son los espacios de firma
 * que tenga el documento. Cuando se ocupan todos, el enlace deja de admitir
 * firmas solo. Por eso hay que poner un recuadro por persona esperada.
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
  diasDeVigencia = 14
) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "No autenticado" };

  const token = `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, "");
  const expires = new Date(
    Date.now() + Math.max(1, diasDeVigencia) * 86_400_000
  ).toISOString();

  const { error } = await supabase.from("signing_links").insert({
    document_id: documentId,
    token,
    kind: "grupal",
    created_by: user.id,
    expires_at: expires,
  });
  if (error) return { error: error.message };

  revalidatePath(`/doc/${documentId}`);
  return { token };
}
