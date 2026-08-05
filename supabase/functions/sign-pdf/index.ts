// Edge Function: sign-pdf
//
// Modelo de firma (igual que el de las plataformas de firma serias):
//
//   1. Cada firmante estampa su rúbrica visible en el campo que le toca.
//      El PDF se reescribe, pero todavía NO lleva sello criptográfico.
//   2. Cuando ya no queda ningún campo pendiente, se aplica la firma PAdES
//      sobre el documento completo, con todas las rúbricas ya dentro.
//
// El sello va al final a propósito: estampar una rúbrica obliga a reescribir
// el PDF, y eso invalidaría cualquier sello anterior. Sellando una sola vez al
// cerrar, la firma criptográfica cubre exactamente lo que la gente ve.
//
// Requiere secretos:
//   SIGN_P12_BASE64  - certificado .p12 en base64
//   SIGN_P12_PASS    - passphrase del .p12

import { createClient } from "npm:@supabase/supabase-js@2";
import { SignPdf } from "npm:@signpdf/signpdf@3";
import { P12Signer } from "npm:@signpdf/signer-p12@3";
import { pdflibAddPlaceholder } from "npm:@signpdf/placeholder-pdf-lib@3";
import { PDFDocument, StandardFonts, rgb } from "npm:pdf-lib@1";
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

function decodeDataUrl(dataUrl: string): Uint8Array {
  const comma = dataUrl.indexOf(",");
  const b64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const sameEmail = (a?: string | null, b?: string | null) =>
  !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();

type Field = {
  id: string;
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
  assigned_email: string | null;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader) return json({ error: "Falta Authorization" }, 401);

    // `seal` cierra el documento sin estampar nada: es el acto definitivo, y
    // solo lo puede hacer quien manda en el documento (dueño o editor).
    const { documentId, fieldId, rubric, seal } = await req.json();
    if (!documentId) return json({ error: "Falta documentId" }, 400);
    if (!seal && (!rubric || typeof rubric !== "string"))
      return json({ error: "Falta la rúbrica" }, 400);

    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Cliente con el JWT del usuario → valida identidad y respeta RLS.
    const asUser = createClient(url, anon, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user },
    } = await asUser.auth.getUser();
    if (!user) return json({ error: "No autenticado" }, 401);

    const { data: doc } = await asUser
      .from("documents")
      .select("id, owner_id, name, mime, status, storage_path, signed_path")
      .eq("id", documentId)
      .maybeSingle();
    if (!doc) return json({ error: "Documento no encontrado o sin acceso" }, 404);
    if (doc.mime !== "application/pdf")
      return json({ error: "Solo se pueden firmar PDF" }, 400);
    if (doc.status === "firmado")
      return json(
        { error: "Este documento ya está cerrado y sellado." },
        409
      );

    const isOwner = doc.owner_id === user.id;
    const admin = createClient(url, service);

    // ---- Permiso ---------------------------------------------------------
    // La RLS ya bloquea al lector, pero el error que devolvería sería opaco.
    // Aquí se decide explícitamente y con un mensaje que se entiende.
    let role = "propietario";
    if (!isOwner) {
      const { data: share } = await admin
        .from("document_shares")
        .select("role")
        .eq("document_id", doc.id)
        .eq("user_id", user.id)
        .maybeSingle();
      role = share?.role ?? "";
      if (!role) return json({ error: "No tienes acceso a este documento" }, 403);
      if (role === "lector")
        return json(
          {
            error:
              "Tu permiso es de solo lectura. Pide que te cambien a firmante.",
          },
          403
        );
    }
    const canEditFields = role === "propietario" || role === "editor";

    // ---- Qué campo le corresponde firmar a esta persona -------------------
    const { data: fieldRows } = await admin
      .from("signature_fields")
      .select("id, page, x, y, w, h, assigned_email")
      .eq("document_id", doc.id)
      .order("order_index");
    const fields = (fieldRows ?? []) as Field[];

    const { data: existing } = await admin
      .from("signatures")
      .select("id, field_id, signer_id")
      .eq("document_id", doc.id);
    const signedFieldIds = new Set(
      (existing ?? []).map((s) => s.field_id).filter(Boolean)
    );

    let field: Field | null = null;

    // ---- Cerrar y sellar (sin estampar) -----------------------------------
    if (seal) {
      if (!canEditFields)
        return json(
          {
            error:
              "Solo el propietario o un editor pueden cerrar el documento.",
          },
          403
        );
      const pendientes = fields.filter((f) => !signedFieldIds.has(f.id));
      if (pendientes.length > 0)
        return json(
          {
            error: `Todavía faltan ${pendientes.length} firma(s) por hacer.`,
          },
          409
        );
      if ((existing ?? []).length === 0)
        return json({ error: "El documento no tiene ninguna firma." }, 409);
    } else if (fields.length > 0) {
      if (fieldId) {
        field = fields.find((f) => f.id === fieldId) ?? null;
        if (!field)
          return json({ error: "Ese campo no es de este documento" }, 400);
      } else {
        // Sin campo explícito: el primero pendiente asignado a esta persona.
        field =
          fields.find(
            (f) =>
              !signedFieldIds.has(f.id) && sameEmail(f.assigned_email, user.email)
          ) ??
          (canEditFields
            ? fields.find(
                (f) => !signedFieldIds.has(f.id) && !f.assigned_email
              ) ?? null
            : null);
        if (!field)
          return json(
            { error: "No tienes ningún campo pendiente de firmar." },
            403
          );
      }

      if (signedFieldIds.has(field.id))
        return json({ error: "Ese campo ya está firmado." }, 409);

      // Un campo asignado solo lo firma su destinatario. Dueño y editor pueden
      // cubrir los que quedaron sin asignar, pero no suplantar a nadie.
      const allowed = field.assigned_email
        ? sameEmail(field.assigned_email, user.email)
        : canEditFields;
      if (!allowed)
        return json(
          { error: `Este campo le corresponde a ${field.assigned_email}.` },
          403
        );
    } else {
      // Documento sin campos: solo el dueño lo firma, de una vez.
      if (!isOwner)
        return json(
          { error: "El dueño todavía no te ha asignado un campo de firma." },
          403
        );
      if ((existing ?? []).some((s) => s.signer_id === user.id))
        return json({ error: "Ya firmaste este documento." }, 409);
    }

    // ---- Estampar la rúbrica (salvo si solo se viene a sellar) -------------
    const srcBucket = doc.signed_path ? "signed" : "originals";
    const srcPath = doc.signed_path ?? doc.storage_path;
    const { data: file, error: dlErr } = await admin.storage
      .from(srcBucket)
      .download(srcPath);
    if (dlErr || !file)
      return json({ error: `No se pudo leer el PDF: ${dlErr?.message}` }, 500);

    const inputBytes = new Uint8Array(await file.arrayBuffer());
    const inputHash = await sha256Hex(inputBytes);

    const pdfDoc = await PDFDocument.load(inputBytes);
    const pages = pdfDoc.getPages();
    const stamped = new Date();

    if (!seal) {
      const target = field
        ? { page: field.page, x: field.x, y: field.y, w: field.w, h: field.h }
        : (() => {
            // Sin campo definido: esquina inferior derecha de la última página.
            const p = pages[pages.length - 1];
            const { width } = p.getSize();
            return { page: pages.length, x: width - 220, y: 60, w: 170, h: 55 };
          })();

      const page = pages[Math.min(Math.max(target.page, 1), pages.length) - 1];
      const png = await pdfDoc.embedPng(decodeDataUrl(rubric));

      // La rúbrica ocupa la parte alta del recuadro; abajo va el pie de firma.
      const captionH = 11;
      const inkH = Math.max(10, target.h - captionH - 4);
      const fit = Math.min(target.w / png.width, inkH / png.height);
      const dw = png.width * fit;
      const dh = png.height * fit;

      page.drawImage(png, {
        x: target.x + (target.w - dw) / 2,
        y: target.y + captionH + 4 + (inkH - dh) / 2,
        width: dw,
        height: dh,
      });

      const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
      const pad = (n: number) => String(n).padStart(2, "0");
      // Solo ASCII: Helvetica/WinAnsi no cubre todo y el pie debe ser fiable.
      const caption = `${user.email ?? "firmante"} - ${pad(
        stamped.getUTCDate()
      )}/${pad(stamped.getUTCMonth() + 1)}/${stamped.getUTCFullYear()} ${pad(
        stamped.getUTCHours()
      )}:${pad(stamped.getUTCMinutes())} UTC`;

      const captionSize = 6;
      const captionW = font.widthOfTextAtSize(caption, captionSize);
      page.drawLine({
        start: { x: target.x, y: target.y + captionH + 2 },
        end: { x: target.x + target.w, y: target.y + captionH + 2 },
        thickness: 0.4,
        color: rgb(0.45, 0.45, 0.45),
      });
      page.drawText(caption, {
        x: target.x + Math.max(0, (target.w - captionW) / 2),
        y: target.y + 3,
        size: captionSize,
        font,
        color: rgb(0.32, 0.32, 0.32),
      });
    }

    // ---- ¿Cierra el documento? -------------------------------------------
    // Nunca por firmar. El sello es el acto definitivo -- después nadie puede
    // tocar el PDF sin romper la firma, ni sumarse a firmar-- y por eso exige
    // una decisión aparte: `seal`, que solo puede pedir el dueño o un editor.
    // Firmar el último campo deja el documento completo, pero abierto.
    const remaining = fields.filter(
      (f) => !signedFieldIds.has(f.id) && f.id !== field?.id
    );
    const complete = !!seal;

    let outBytes: Uint8Array;

    if (complete) {
      // Cierre: se sella el documento entero, rúbricas incluidas.
      const p12b64 = Deno.env.get("SIGN_P12_BASE64");
      const p12pass = Deno.env.get("SIGN_P12_PASS");
      if (!p12b64 || !p12pass)
        return json({ error: "Certificado de firma no configurado" }, 500);

      pdflibAddPlaceholder({
        pdfDoc,
        reason: `Firmado en FirmaDrive por ${
          (existing ?? []).length + (seal ? 0 : 1)
        } firmante(s)`,
        contactInfo: user.email ?? "",
        name: user.email ?? "Firmante",
        location: "FirmaDrive",
      });

      // useObjectStreams:false → xref clásico, necesario para hallar el ByteRange.
      const withPlaceholder = await pdfDoc.save({ useObjectStreams: false });
      const signer = new P12Signer(Buffer.from(p12b64, "base64"), {
        passphrase: p12pass,
      });
      const signedBuffer: Buffer = await new SignPdf().sign(
        Buffer.from(withPlaceholder),
        signer
      );
      outBytes = new Uint8Array(signedBuffer);
    } else {
      // Quedan firmantes: solo se guarda la rúbrica, sin sellar todavía.
      outBytes = await pdfDoc.save({ useObjectStreams: false });
    }

    const outHash = await sha256Hex(outBytes);
    const outPath = `${doc.owner_id}/${doc.id}.pdf`;
    const { error: upErr } = await admin.storage
      .from("signed")
      .upload(outPath, outBytes, {
        contentType: "application/pdf",
        upsert: true,
      });
    if (upErr)
      return json({ error: `No se pudo guardar: ${upErr.message}` }, 500);

    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;

    if (seal) {
      // Cerrar no añade una firma nueva: acredita las que ya estaban.
      const { error: certErr } = await admin
        .from("signatures")
        .update({ cert_subject: "CN=FirmaDrive Dev Signer" })
        .eq("document_id", doc.id);
      if (certErr) console.error("signatures.update:", certErr);
    } else {
      const { error: sigErr } = await admin.from("signatures").insert({
        document_id: doc.id,
        field_id: field?.id ?? null,
        signer_id: user.id,
        signed_at: stamped.toISOString(),
        ip,
        cert_subject: complete ? "CN=FirmaDrive Dev Signer" : null,
        tsa_token: null,
      });
      if (sigErr) console.error("signatures.insert:", sigErr);
    }

    const { error: updErr } = await admin
      .from("documents")
      .update({
        signed_path: outPath,
        current_hash: outHash,
        status: complete ? "firmado" : "en_firma",
      })
      .eq("id", doc.id);
    if (updErr) console.error("documents.update:", updErr);

    await admin.from("audit_log").insert({
      document_id: doc.id,
      actor_id: user.id,
      action: seal ? "cerrar_y_sellar" : complete ? "firmar_y_sellar" : "firmar",
      ip,
      metadata: {
        email: user.email,
        field_id: field?.id ?? null,
        input_hash: inputHash,
        output_hash: outHash,
        sealed: complete,
        remaining: remaining.length,
      },
    });

    return json({
      ok: true,
      sealed: complete,
      status: complete ? "firmado" : "en_firma",
      remaining: remaining.length,
      signed_path: outPath,
      hash: outHash,
    });
  } catch (err) {
    console.error("sign-pdf:", err);
    return json(
      { error: err instanceof Error ? err.message : "Error al firmar" },
      500
    );
  }
});
