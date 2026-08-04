// Edge Function: sign-pdf
// Aplica una firma digital PAdES (PKCS#12 / X.509) a un PDF almacenado.
// Multi-firmante: si el documento ya tiene una versión firmada, firma sobre esa
// (cadena de firmas). Registra la firma, actualiza estado y escribe auditoría.
//
// Requiere secretos (supabase/functions/.env):
//   SIGN_P12_BASE64  - certificado .p12 en base64
//   SIGN_P12_PASS    - passphrase del .p12

import { createClient } from "npm:@supabase/supabase-js@2";
import { SignPdf } from "npm:@signpdf/signpdf@3";
import { P12Signer } from "npm:@signpdf/signer-p12@3";
import { pdflibAddPlaceholder } from "npm:@signpdf/placeholder-pdf-lib@3";
import { PDFDocument } from "npm:pdf-lib@1";
import { Buffer } from "node:buffer";

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

    // Cliente con el JWT del usuario → valida identidad y RLS.
    const asUser = createClient(url, anon, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user },
    } = await asUser.auth.getUser();
    if (!user) return json({ error: "No autenticado" }, 401);

    // El usuario debe poder VER el documento (RLS: dueño o compartido).
    const { data: doc } = await asUser
      .from("documents")
      .select("id, owner_id, name, mime, storage_path, signed_path")
      .eq("id", documentId)
      .maybeSingle();
    if (!doc) return json({ error: "Documento no encontrado o sin acceso" }, 404);
    if (doc.mime !== "application/pdf")
      return json({ error: "Solo se pueden firmar PDF" }, 400);

    // No permitir firma duplicada del mismo usuario.
    const { data: prev } = await asUser
      .from("signatures")
      .select("id")
      .eq("document_id", documentId)
      .eq("signer_id", user.id)
      .maybeSingle();
    if (prev) return json({ error: "Ya firmaste este documento" }, 409);

    // Cliente service role para leer/escribir Storage y filas del sistema.
    const admin = createClient(url, service);

    // Base: la última versión firmada (cadena) o el original.
    const srcBucket = doc.signed_path ? "signed" : "originals";
    const srcPath = doc.signed_path ?? doc.storage_path;
    const { data: file, error: dlErr } = await admin.storage
      .from(srcBucket)
      .download(srcPath);
    if (dlErr || !file)
      return json({ error: `No se pudo leer el PDF: ${dlErr?.message}` }, 500);

    const inputBytes = new Uint8Array(await file.arrayBuffer());
    const originalHash = await sha256Hex(inputBytes);

    // Cargar certificado.
    const p12b64 = Deno.env.get("SIGN_P12_BASE64");
    const p12pass = Deno.env.get("SIGN_P12_PASS");
    if (!p12b64 || !p12pass)
      return json({ error: "Certificado de firma no configurado" }, 500);
    const p12Buffer = Buffer.from(p12b64, "base64");

    // Añadir placeholder de firma (vía pdf-lib, robusto con xref modernos) y firmar.
    const pdfDoc = await PDFDocument.load(inputBytes);
    pdflibAddPlaceholder({
      pdfDoc,
      reason: `Firmado por ${user.email}`,
      contactInfo: user.email ?? "",
      name: user.email ?? "Firmante",
      location: "FirmaDrive",
    });
    // useObjectStreams:false → xref table clásica para que signpdf halle el ByteRange.
    const withPlaceholder = await pdfDoc.save({ useObjectStreams: false });
    const signer = new P12Signer(p12Buffer, { passphrase: p12pass });
    const signedBuffer: Buffer = await new SignPdf().sign(
      Buffer.from(withPlaceholder),
      signer
    );
    const signedBytes = new Uint8Array(signedBuffer);
    const signedHash = await sha256Hex(signedBytes);

    // Subir versión firmada (sobrescribe la anterior de la cadena).
    const outPath = `${doc.owner_id}/${doc.id}.pdf`;
    const { error: upErr } = await admin.storage
      .from("signed")
      .upload(outPath, signedBytes, {
        contentType: "application/pdf",
        upsert: true,
      });
    if (upErr) return json({ error: `No se pudo guardar: ${upErr.message}` }, 500);

    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;

    // Registrar la firma.
    const { error: sigErr } = await admin.from("signatures").insert({
      document_id: doc.id,
      signer_id: user.id,
      signed_at: new Date().toISOString(),
      ip,
      cert_subject: "CN=FirmaDrive Dev Signer",
      tsa_token: null,
    });
    if (sigErr) console.error("signatures.insert:", sigErr);

    // ¿Firmado por todos? Comparar nº de firmas con nº de campos asignados.
    const [{ count: sigCount }, { count: fieldCount }] = await Promise.all([
      admin
        .from("signatures")
        .select("id", { count: "exact", head: true })
        .eq("document_id", doc.id),
      admin
        .from("signature_fields")
        .select("id", { count: "exact", head: true })
        .eq("document_id", doc.id),
    ]);
    const complete = (fieldCount ?? 0) > 0 && (sigCount ?? 0) >= (fieldCount ?? 0);

    const { error: updErr } = await admin
      .from("documents")
      .update({
        signed_path: outPath,
        current_hash: signedHash,
        status: complete ? "firmado" : "en_firma",
      })
      .eq("id", doc.id);
    if (updErr) console.error("documents.update:", updErr);

    // Auditoría (append-only).
    await admin.from("audit_log").insert({
      document_id: doc.id,
      actor_id: user.id,
      action: "firmar",
      ip,
      metadata: {
        email: user.email,
        input_hash: originalHash,
        output_hash: signedHash,
        complete,
      },
    });

    return json({
      ok: true,
      status: complete ? "firmado" : "en_firma",
      signed_path: outPath,
      hash: signedHash,
    });
  } catch (err) {
    return json(
      { error: err instanceof Error ? err.message : "Error al firmar" },
      500
    );
  }
});
