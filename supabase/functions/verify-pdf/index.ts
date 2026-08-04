// Edge Function: verify-pdf
// Verifica un documento firmado:
//   - detecta la presencia de firma(s) digitales en el PDF (/ByteRange /Contents)
//   - comprueba la integridad por hash (SHA-256 vs el registrado al firmar)
//   - devuelve la lista de firmantes y el rastro de auditoría
//
// Nota: la validación completa de la cadena de certificados (CA de confianza) y
// del sellado de tiempo se conecta en producción con un proveedor/TSA real.

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

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader) return json({ error: "Falta Authorization" }, 401);

    const { documentId } = await req.json();
    if (!documentId) return json({ error: "Falta documentId" }, 400);

    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const asUser = createClient(url, anon, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user },
    } = await asUser.auth.getUser();
    if (!user) return json({ error: "No autenticado" }, 401);

    const { data: doc } = await asUser
      .from("documents")
      .select("id, name, status, signed_path, current_hash")
      .eq("id", documentId)
      .maybeSingle();
    if (!doc) return json({ error: "Documento no encontrado o sin acceso" }, 404);
    if (!doc.signed_path)
      return json({ valid: false, reason: "El documento no está firmado" });

    const admin = createClient(url, service);
    const { data: file, error: dlErr } = await admin.storage
      .from("signed")
      .download(doc.signed_path);
    if (dlErr || !file)
      return json({ error: `No se pudo leer el PDF firmado` }, 500);

    const bytes = new Uint8Array(await file.arrayBuffer());
    const text = new TextDecoder("latin1").decode(bytes);

    // Detectar firmas: cada firma PAdES deja un /ByteRange y /Contents.
    const byteRanges = (text.match(/\/ByteRange/g) ?? []).length;
    const hasSignature = byteRanges > 0 && text.includes("/Contents");

    // Integridad: el hash actual debe coincidir con el registrado al firmar.
    const currentHash = await sha256Hex(bytes);
    const hashMatch = currentHash === doc.current_hash;

    const { data: signers } = await asUser
      .from("signatures")
      .select("signer_id, signed_at, cert_subject, ip")
      .eq("document_id", doc.id)
      .order("signed_at");

    const { data: audit } = await asUser
      .from("audit_log")
      .select("action, actor_id, created_at, metadata")
      .eq("document_id", doc.id)
      .order("created_at");

    return json({
      valid: hasSignature && hashMatch,
      hasSignature,
      hashMatch,
      signatureCount: byteRanges,
      currentHash,
      registeredHash: doc.current_hash,
      status: doc.status,
      signers: signers ?? [],
      audit: audit ?? [],
      note:
        "Integridad y presencia de firma verificadas. La validación de la cadena de CA y el sello de tiempo se activan en producción.",
    });
  } catch (err) {
    return json(
      { error: err instanceof Error ? err.message : "Error al verificar" },
      500
    );
  }
});
