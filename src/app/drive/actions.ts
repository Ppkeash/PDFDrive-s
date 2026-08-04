"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

// Server Actions de la Fase 1. La RLS de Supabase garantiza que solo el dueño
// (o quien tenga acceso) pueda mutar cada fila; aquí solo orquestamos.

export async function createFolder(name: string) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "No autenticado" };

  const { error } = await supabase
    .from("folders")
    .insert({ owner_id: user.id, name });
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

  // Si el invitado ya tiene cuenta, enlazamos su user_id.
  const { data: profile } = await supabase
    .from("profiles")
    .select("id")
    .eq("email", email)
    .maybeSingle();

  const { error } = await supabase.from("document_shares").upsert(
    {
      document_id: documentId,
      email,
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
    metadata: { email, role },
  });

  revalidatePath(`/doc/${documentId}`);
  return {};
}
