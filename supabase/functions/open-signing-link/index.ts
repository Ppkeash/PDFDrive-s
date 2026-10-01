// Edge Function: open-signing-link
//
// Abre un enlace de firma de un solo uso (ver migración 0017) para alguien que
// no tiene cuenta. Devuelve lo justo para pintar la pantalla de firma: el
// nombre del documento, una URL temporal del PDF y el recuadro donde va la
// rúbrica.
//
// Es pública a propósito -- quien la llama todavía no se ha autenticado con
// nada -- así que el token es la única credencial. Por eso no devuelve nada
// que sirva para otra cosa: ni el id del dueño, ni la lista de firmantes, ni
// el resto de documentos. Y la URL del PDF es firmada y de corta duración.

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

/**
 * Cuánto vive la URL del PDF.
 *
 * Estaba en 10 minutos y resultó muy poco: la pantalla pide el nombre antes de
 * mostrar el documento, así que entre que alguien abre el enlace, lo deja un
 * rato y vuelve, la URL ya había caducado -- y el documento salía con "No se
 * pudo abrir el PDF" sin explicar por qué.
 *
 * Dos horas cubre de sobra una reunión, que es el caso real, y no es más
 * permisivo que el enlace mismo: el enlace también vence a las 2 horas.
 */
const URL_SEGUNDOS = 2 * 60 * 60;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const { token } = await req.json();
    if (!token || typeof token !== "string")
      return json({ ok: false, motivo: "no_existe" }, 404);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: estado } = await admin.rpc("estado_enlace_de_firma", {
      p_token: token,
    });

    const e = estado as Record<string, unknown> | null;
    if (!e?.ok) return json(e ?? { ok: false, motivo: "no_existe" }, 200);

    const { data: doc } = await admin
      .from("documents")
      .select("id, name, storage_path, signed_path, status")
      .eq("id", e.document_id as string)
      .maybeSingle();
    if (!doc) return json({ ok: false, motivo: "no_existe" }, 200);

    // El PDF vigente: el firmado si ya hay rúbricas encima, si no el original.
    const bucket = doc.signed_path ? "signed" : "originals";
    const path = doc.signed_path ?? doc.storage_path;

    const { data: firmada, error: urlErr } = await admin.storage
      .from(bucket)
      .createSignedUrl(path, URL_SEGUNDOS);
    if (urlErr || !firmada)
      return json({ ok: false, motivo: "pdf_no_disponible" }, 200);

    // El recuadro, solo si el enlace apunta a un campo concreto. Sin campo, la
    // rúbrica cae donde `sign-pdf` decida; la pantalla no tiene que saberlo.
    let campo: Record<string, number> | null = null;
    if (e.field_id) {
      const { data: f } = await admin
        .from("signature_fields")
        .select("page, x, y, w, h")
        .eq("id", e.field_id as string)
        .maybeSingle();
      if (f) campo = f as unknown as Record<string, number>;

      const { count } = await admin
        .from("signatures")
        .select("id", { count: "exact", head: true })
        .eq("field_id", e.field_id as string);
      if ((count ?? 0) > 0)
        return json({ ok: false, motivo: "campo_ya_firmado" }, 200);
    }

    return json({
      ok: true,
      kind: e.kind ?? "individual",
      documento: doc.name,
      etiqueta: e.etiqueta ?? null,
      pdf_url: firmada.signedUrl,
      campo,
      // Solo en los grupales: la lista cerrada de nombres, con cuáles ya
      // firmaron. Es lo único que esta pantalla necesita saber de los demás.
      cupos: e.cupos ?? null,
    });
  } catch (err) {
    console.error("open-signing-link:", err);
    return json({ ok: false, motivo: "error" }, 500);
  }
});
