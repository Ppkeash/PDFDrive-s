// Edge Function: accept-invite
//
// Contraparte del link único de invitación (ver migración 0006 y
// ShareDialog): quien lo abre queda como firmante del documento, sin que el
// dueño tenga que teclear su correo de antemano. Pensado para reenviarlo por
// WhatsApp o donde sea, a varias personas, con un solo enlace.
//
// El link deja de servir solo (sin fecha de vencimiento propia) en cuanto el
// documento se cierra -- `status = 'firmado'` -- porque ya no hay nada que
// firmar. El dueño también puede revocarlo antes: basta con regenerar o
// borrar `documents.invite_token`.

import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader) return json({ error: "Falta Authorization" }, 401);

    const { token } = await req.json();
    if (!token || typeof token !== "string")
      return json({ error: "Falta el link" }, 400);

    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const asUser = createClient(url, anon, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user },
    } = await asUser.auth.getUser();
    if (!user?.email) return json({ error: "No autenticado" }, 401);

    const admin = createClient(url, service);

    const { data: doc } = await admin
      .from("documents")
      .select("id, owner_id, status")
      .eq("invite_token", token)
      .maybeSingle();
    if (!doc) return json({ error: "Este link no es válido." }, 404);
    if (doc.status === "firmado")
      return json(
        { error: "Este link ya no sirve: el documento está cerrado." },
        410
      );

    // El dueño abriendo su propio link no necesita una fila de acceso.
    if (doc.owner_id === user.id) return json({ documentId: doc.id });

    const email = user.email.trim().toLowerCase();
    const { data: existing } = await admin
      .from("document_shares")
      .select("role, user_id")
      .eq("document_id", doc.id)
      .eq("email", email)
      .maybeSingle();

    if (existing) {
      // Ya tiene acceso (quizás con un rol mejor que "firmante" -- no se
      // pisa). Si le faltaba enlazar la cuenta, se enlaza ahora.
      if (!existing.user_id) {
        await admin
          .from("document_shares")
          .update({ user_id: user.id })
          .eq("document_id", doc.id)
          .eq("email", email);
      }
    } else {
      const { error: insErr } = await admin.from("document_shares").insert({
        document_id: doc.id,
        email,
        role: "firmante",
        user_id: user.id,
      });
      if (insErr) return json({ error: insErr.message }, 500);
    }

    await admin.from("audit_log").insert({
      document_id: doc.id,
      actor_id: user.id,
      action: "invitacion_link",
      metadata: { email },
    });

    return json({ documentId: doc.id });
  } catch (err) {
    return json(
      { error: err instanceof Error ? err.message : "Error inesperado" },
      500
    );
  }
});
