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

export async function shareDocument(
  documentId: string,
  email: string,
  role: "editor" | "firmante" | "lector"
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
