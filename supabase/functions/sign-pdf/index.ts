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

/**
 * Quien firma. Hay dos formas de llegar aquí y no valen lo mismo:
 * con cuenta de Google (identidad verificada) o con un enlace de un solo uso
 * (ver migración 0017), donde la credencial es el enlace y el nombre lo
 * escribe quien lo abre. La diferencia queda grabada en `signer_kind`.
 */
type Actor = {
  userId: string | null;
  email: string | null;
  name: string | null;
  kind: "cuenta" | "enlace";
  linkId: string | null;
  /** Cupo tomado en un enlace grupal; null en los individuales. */
  slotId: string | null;
  /** Dos cupos del mismo enlace desde el mismo navegador. Se anota, no se bloquea. */
  deviceReused: boolean;
};

function motivoEnlace(motivo: unknown): string {
  switch (motivo) {
    case "ya_usado":
      return "Este enlace ya se usó para firmar.";
    case "revocado":
      return "Este enlace fue desactivado.";
    case "vencido":
      return "Este enlace venció.";
    case "documento_cerrado":
      return "El documento ya está cerrado.";
    case "campo_ya_firmado":
      return "Ese espacio ya está firmado.";
    case "lista_completa":
      return "Ya firmaron todas las personas de la lista.";
    case "sin_espacios":
      return "Ya no quedan espacios para firmar en este documento.";
    case "cupo_lleno":
      return "Este enlace ya recibió todas las firmas que admitía.";
    case "cupo_tomado":
      return "Alguien acaba de firmar con ese nombre. Elige otro o avisa a quien te envió el enlace.";
    default:
      return "Este enlace no es válido.";
  }
}

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

  // Fuera del try para que el catch pueda devolver la plaza reservada.
  let usoReservadoGlobal: string | null = null;

  try {
    // `seal` cierra el documento sin estampar nada: es el acto definitivo, y
    // solo lo puede hacer quien manda en el documento (dueño o editor).
    // `retract` quita una rúbrica ya puesta (se firmó mal) para volver a
    // firmar; solo vale mientras el documento siga abierto.
    const {
      documentId,
      fieldId,
      rubric,
      seal,
      retract,
      linkToken,
      signerName,
      slotId,
      deviceId,
      box,
    } = await req.json();
    if (!seal && !retract && (!rubric || typeof rubric !== "string"))
      return json({ error: "Falta la rúbrica" }, 400);

    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(url, service);

    let actor: Actor;
    let docId: string | null = documentId ?? null;
    let linkFieldId: string | null = null;
    // Se conserva para el camino con cuenta: la lectura del documento sigue
    // pasando por RLS, como antes.
    let asUser: ReturnType<typeof createClient> | null = null;
    // Plaza del enlace ya reservada. Si algo falla después hay que
    // devolverla: un error de red no puede robarle un cupo al grupo.
    let usoReservado: string | null = null;

    if (typeof linkToken === "string" && linkToken.length > 0) {
      // Un enlace sirve para una cosa: poner una rúbrica. Ni cerrar el
      // documento ni deshacer la firma de nadie.
      if (seal || retract)
        return json({ error: "Este enlace solo sirve para firmar." }, 403);

      const { data: estado } = await admin.rpc("estado_enlace_de_firma", {
        p_token: linkToken,
      });
      const e = estado as Record<string, unknown> | null;
      if (!e?.ok) return json({ error: motivoEnlace(e?.motivo) }, 403);

      const grupal = e.kind === "grupal";
      let nombre: string;
      let cupo: string | null = null;
      let dispositivoRepetido = false;

      // Un enlace grupal sin lista es abierto: cada quien escribe su nombre y
      // el tope lo pone el documento, no una lista. Con lista, el nombre no se
      // escribe -- se escoge, y eso es lo que impide que un extraño se invente
      // uno.
      const abierto = Boolean(e.abierto);

      if (grupal && !abierto) {
        if (typeof slotId !== "string" || !slotId)
          return json({ error: "Escoge tu nombre de la lista." }, 400);

        const { data: reserva } = await admin.rpc("tomar_cupo_de_firma", {
          p_link_id: e.link_id as string,
          p_slot_id: slotId,
          p_device: typeof deviceId === "string" ? deviceId.slice(0, 80) : null,
        });
        const r = reserva as Record<string, unknown> | null;
        if (!r?.ok) return json({ error: motivoEnlace(r?.motivo) }, 409);

        nombre = r.nombre as string;
        cupo = slotId;
        dispositivoRepetido = Boolean(r.dispositivo_repetido);
      } else {
        nombre = typeof signerName === "string" ? signerName.trim() : "";
        if (nombre.length < 3)
          return json({ error: "Escribe tu nombre completo para firmar." }, 400);
        if (nombre.length > 120)
          return json({ error: "Ese nombre es demasiado largo." }, 400);
      }

      // El documento lo manda el enlace, nunca el cliente: si no, cualquiera
      // con un enlace válido firmaría en un documento ajeno.
      docId = e.document_id as string;
      linkFieldId = (e.field_id as string | null) ?? null;

      if (abierto) {
        // En un enlace abierto no hay recuadros preparados: cada quien deja su
        // firma donde corresponda en ese documento. La posición la elige quien
        // firma y llega aquí; el recuadro se crea en ese sitio.
        const caja = box as Record<string, unknown> | null;
        if (!caja) return json({ error: "Falta dónde va la firma." }, 400);

        const num = (v: unknown) =>
          typeof v === "number" && Number.isFinite(v) ? v : null;
        const pagina = num(caja.page);
        const bx = num(caja.x);
        const by = num(caja.y);
        const bw = num(caja.w);
        const bh = num(caja.h);

        if (
          pagina === null || pagina < 1 || pagina > 2000 ||
          bx === null || by === null ||
          bw === null || bh === null ||
          bx < 0 || by < 0 ||
          bw < 20 || bh < 10 || bw > 600 || bh > 400
        )
          return json({ error: "Esa posición no es válida." }, 400);

        // Reservar antes de crear nada: si diez personas firman a la vez
        // sobre las últimas dos plazas, solo dos pasan.
        const { data: reserva } = await admin.rpc("reservar_uso_de_enlace", {
          p_link_id: e.link_id as string,
        });
        const r = reserva as Record<string, unknown> | null;
        if (!r?.ok) return json({ error: motivoEnlace(r?.motivo) }, 409);
        usoReservado = e.link_id as string;
        usoReservadoGlobal = usoReservado;

        const { data: campoNuevo, error: campoErr } = await admin
          .from("signature_fields")
          .insert({
            document_id: docId,
            page: Math.round(pagina),
            x: Math.round(bx * 100) / 100,
            y: Math.round(by * 100) / 100,
            w: Math.round(bw * 100) / 100,
            h: Math.round(bh * 100) / 100,
            assigned_email: null,
          })
          .select("id")
          .single();

        if (campoErr || !campoNuevo) {
          await admin.rpc("devolver_uso_de_enlace", {
            p_link_id: e.link_id as string,
          });
          usoReservado = null;
          usoReservadoGlobal = null;
          return json({ error: "No se pudo guardar la posición." }, 500);
        }

        linkFieldId = campoNuevo.id as string;
      }
      actor = {
        userId: null,
        email: null,
        name: nombre,
        kind: "enlace",
        linkId: e.link_id as string,
        slotId: cupo,
        deviceReused: dispositivoRepetido,
      };
    } else {
      const authHeader = req.headers.get("Authorization") ?? "";
      if (!authHeader) return json({ error: "Falta Authorization" }, 401);
      if (!docId) return json({ error: "Falta documentId" }, 400);

      // Cliente con el JWT del usuario → valida identidad y respeta RLS.
      asUser = createClient(url, anon, {
        global: { headers: { Authorization: authHeader } },
      });
      const {
        data: { user },
      } = await asUser.auth.getUser();
      if (!user) return json({ error: "No autenticado" }, 401);

      actor = {
        userId: user.id,
        email: user.email ?? null,
        name: null,
        kind: "cuenta",
        linkId: null,
        slotId: null,
        deviceReused: false,
      };
    }

    const { data: doc } = await (asUser ?? admin)
      .from("documents")
      .select("id, owner_id, name, mime, status, storage_path, signed_path")
      .eq("id", docId as string)
      .maybeSingle();
    if (!doc) return json({ error: "Documento no encontrado o sin acceso" }, 404);
    if (doc.mime !== "application/pdf")
      return json({ error: "Solo se pueden firmar PDF" }, 400);
    if (doc.status === "firmado")
      return json(
        { error: "Este documento ya está cerrado y sellado." },
        409
      );

    const isOwner = actor.userId !== null && doc.owner_id === actor.userId;

    // ---- Permiso ---------------------------------------------------------
    // La RLS ya bloquea al lector, pero el error que devolvería sería opaco.
    // Aquí se decide explícitamente y con un mensaje que se entiende.
    let role = "propietario";
    if (actor.kind === "enlace") {
      // El enlace ya fue validado contra la base: concede firmar, nada más.
      role = "firmante";
    } else if (!isOwner) {
      const { data: share } = await admin
        .from("document_shares")
        .select("role")
        .eq("document_id", doc.id)
        .eq("user_id", actor.userId as string)
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
      .select("id, field_id, signer_id, rubric_path")
      .eq("document_id", doc.id);
    const signedFieldIds = new Set(
      (existing ?? []).map((s) => s.field_id).filter(Boolean)
    );

    // ---- Deshacer una firma ------------------------------------------------
    // Aparte de todo lo demás: no reserva campo, no estampa. Reconstruye el
    // PDF desde el original y reestampa solo las rúbricas que siguen en pie
    // (por eso cada una se guarda por separado en el bucket `rubrics` al
    // firmar -- una vez quemada en el PDF anterior no hay forma de borrarla
    // de ahí).
    if (retract) {
      const target = fieldId
        ? (existing ?? []).find((s) => s.field_id === fieldId)
        : (existing ?? []).find(
            (s) => !s.field_id && s.signer_id === actor.userId
          );
      if (!target)
        return json({ error: "No hay ninguna firma que deshacer ahí." }, 404);

      const canRetract = target.signer_id === actor.userId || canEditFields;
      if (!canRetract)
        return json(
          { error: "No puedes deshacer la firma de otra persona." },
          403
        );

      const { error: delErr } = await admin
        .from("signatures")
        .delete()
        .eq("id", target.id);
      if (delErr)
        return json({ error: `No se pudo deshacer: ${delErr.message}` }, 500);

      // El recuadro no se queda ahí esperando: deshacer borra la firma Y el
      // campo. Volver a firmar en ese sitio es un acto aparte -- alguien
      // tiene que colocar un campo nuevo, no queda reservado solo.
      if (target.field_id) {
        const { error: fieldDelErr } = await admin
          .from("signature_fields")
          .delete()
          .eq("id", target.field_id);
        if (fieldDelErr)
          console.error("signature_fields.delete tras deshacer:", fieldDelErr);
      }

      const stillSigned = (existing ?? []).filter((s) => s.id !== target.id);

      const { data: origFile, error: origErr } = await admin.storage
        .from("originals")
        .download(doc.storage_path);
      if (origErr || !origFile)
        return json(
          { error: `No se pudo leer el original: ${origErr?.message}` },
          500
        );

      const rebuilt = await PDFDocument.load(
        new Uint8Array(await origFile.arrayBuffer())
      );
      const rebuiltPages = rebuilt.getPages();

      for (const s of stillSigned) {
        // Firmas de antes de este cambio no tienen PNG guardado: se pierden
        // al reconstruir, no hay de dónde recuperarlas.
        if (!s.rubric_path) continue;
        const { data: rubFile } = await admin.storage
          .from("rubrics")
          .download(s.rubric_path);
        if (!rubFile) continue;

        const f = s.field_id ? fields.find((x) => x.id === s.field_id) : null;
        const t = f
          ? { page: f.page, x: f.x, y: f.y, w: f.w, h: f.h }
          : (() => {
              const p = rebuiltPages[rebuiltPages.length - 1];
              const { width } = p.getSize();
              return {
                page: rebuiltPages.length,
                x: width - 220,
                y: 60,
                w: 170,
                h: 55,
              };
            })();

        const page =
          rebuiltPages[Math.min(Math.max(t.page, 1), rebuiltPages.length) - 1];
        const png = await rebuilt.embedPng(
          new Uint8Array(await rubFile.arrayBuffer())
        );
        const fit = Math.min(t.w / png.width, t.h / png.height);
        const dw = png.width * fit;
        const dh = png.height * fit;
        page.drawImage(png, {
          x: t.x + (t.w - dw) / 2,
          y: t.y + (t.h - dh) / 2,
          width: dw,
          height: dh,
        });
      }

      let outPath: string | null = null;
      let outHash: string | null = null;

      if (stillSigned.length > 0) {
        const outBytes = await rebuilt.save({ useObjectStreams: false });
        outHash = await sha256Hex(outBytes);
        outPath = `${doc.owner_id}/${doc.id}.pdf`;
        const { error: upErr } = await admin.storage
          .from("signed")
          .upload(outPath, outBytes, {
            contentType: "application/pdf",
            upsert: true,
          });
        if (upErr)
          return json({ error: `No se pudo guardar: ${upErr.message}` }, 500);
      } else if (doc.signed_path) {
        await admin.storage.from("signed").remove([doc.signed_path]);
      }

      if (target.rubric_path)
        await admin.storage.from("rubrics").remove([target.rubric_path]);

      const { error: updErr } = await admin
        .from("documents")
        .update({ signed_path: outPath, current_hash: outHash, status: "en_firma" })
        .eq("id", doc.id);
      if (updErr) console.error("documents.update:", updErr);

      const ip =
        req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
      await admin.from("audit_log").insert({
        document_id: doc.id,
        actor_id: actor.userId,
        action: "deshacer_firma",
        ip,
        metadata: {
          field_id: target.field_id,
          retracted_signer: target.signer_id,
        },
      });

      return json({
        ok: true,
        sealed: false,
        status: "en_firma",
        remaining: fields.length - stillSigned.length,
        signed_path: outPath,
        hash: outHash,
      });
    }

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
    } else if (actor.kind === "enlace") {
      // El campo lo fija quien creó el enlace, no quien lo abre.
      if (linkFieldId) {
        field = fields.find((f) => f.id === linkFieldId) ?? null;
        if (!field)
          return json({ error: "Ese espacio ya no existe en el documento." }, 409);
        if (signedFieldIds.has(field.id))
          return json({ error: "Ese espacio ya está firmado." }, 409);
      } else if (fields.length > 0) {
        // Enlace sin campo: el primero libre y sin dueño asignado. Nunca uno
        // asignado a un correo -- esa firma le corresponde a esa persona.
        field =
          fields.find((f) => !signedFieldIds.has(f.id) && !f.assigned_email) ??
          null;
        if (!field)
          return json(
            { error: "No queda ningún espacio libre para firmar." },
            409
          );
      }
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
              !signedFieldIds.has(f.id) &&
              sameEmail(f.assigned_email, actor.email)
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
        ? sameEmail(field.assigned_email, actor.email)
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
      if ((existing ?? []).some((s) => s.signer_id === actor.userId))
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

    // Id fijado de antemano: así la rúbrica se guarda en el bucket bajo el
    // mismo id que la fila de `signatures`, y "deshacer firma" sabe qué PNG
    // recuperar sin tener que hacer una vuelta extra a la base.
    const sigId = crypto.randomUUID();
    let rubricPath: string | null = null;

    if (!seal) {
      const target = field
        ? { page: field.page, x: field.x, y: field.y, w: field.w, h: field.h }
        : (() => {
            // Sin campo definido: esquina inferior derecha de la última página.
            const p = pages[pages.length - 1];
            const { width } = p.getSize();
            return { page: pages.length, x: width - 220, y: 60, w: 170, h: 55 };
          })();

      const rubricBytes = decodeDataUrl(rubric);
      const page = pages[Math.min(Math.max(target.page, 1), pages.length) - 1];
      const png = await pdfDoc.embedPng(rubricBytes);

      // Solo el dibujo de la firma va sobre el PDF -- nada de correo, hora
      // ni línea de pie. Ese rastro (quién, cuándo, IP) ya queda guardado
      // en `signatures`/`audit_log`; estamparlo encima solo ensuciaba la
      // rúbrica visualmente.
      const fit = Math.min(target.w / png.width, target.h / png.height);
      const dw = png.width * fit;
      const dh = png.height * fit;

      page.drawImage(png, {
        x: target.x + (target.w - dw) / 2,
        y: target.y + (target.h - dh) / 2,
        width: dw,
        height: dh,
      });

      // Se guarda aparte, sin quemar: es lo único que permite reconstruir el
      // PDF sin esta rúbrica si más tarde hay que deshacerla.
      rubricPath = `${doc.owner_id}/${sigId}.png`;
      const { error: rubErr } = await admin.storage
        .from("rubrics")
        .upload(rubricPath, rubricBytes, {
          contentType: "image/png",
          upsert: true,
        });
      if (rubErr) {
        console.error("rubrics.upload:", rubErr);
        rubricPath = null;
      }
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
        contactInfo: actor.email ?? "",
        name: actor.email ?? actor.name ?? "Firmante",
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
    // Para una firma por enlace, IP y navegador son casi todo el rastro que
    // queda de quién estuvo ahí: no hay cuenta detrás.
    const userAgent = req.headers.get("user-agent")?.slice(0, 400) ?? null;

    if (seal) {
      // Cerrar no añade una firma nueva: acredita las que ya estaban.
      const { error: certErr } = await admin
        .from("signatures")
        .update({ cert_subject: "CN=FirmaDrive Dev Signer" })
        .eq("document_id", doc.id);
      if (certErr) console.error("signatures.update:", certErr);
    } else {
      const { error: sigErr } = await admin.from("signatures").insert({
        id: sigId,
        document_id: doc.id,
        field_id: field?.id ?? null,
        signer_id: actor.userId,
        signer_name: actor.name,
        signer_kind: actor.kind,
        signer_user_agent: userAgent,
        signed_at: stamped.toISOString(),
        ip,
        cert_subject: complete ? "CN=FirmaDrive Dev Signer" : null,
        tsa_token: null,
        rubric_path: rubricPath,
      });
      if (sigErr) {
        console.error("signatures.insert:", sigErr);
        return json({ error: "No se pudo registrar la firma." }, 500);
      }

      if (actor.kind === "enlace" && actor.linkId) {
        if (actor.slotId) {
          // El cupo ya se reservó antes de estampar, para que dos personas no
          // puedan tomar el mismo nombre a la vez. Aquí solo se le ata la
          // firma que acaba de quedar.
          const { error: slotErr } = await admin
            .from("signing_link_slots")
            .update({
              signature_id: sigId,
              signer_ip: ip,
              signer_user_agent: userAgent,
            })
            .eq("id", actor.slotId);
          if (slotErr) console.error("signing_link_slots.update:", slotErr);
        } else {
          // Individual: se quema aquí y no antes. Si el estampado falla, el
          // enlace sigue sirviendo y la persona puede reintentar.
          const { error: linkErr } = await admin
            .from("signing_links")
            .update({
              used_at: new Date().toISOString(),
              signer_name: actor.name,
              signer_ip: ip,
              signer_user_agent: userAgent,
              signature_id: sigId,
            })
            .eq("id", actor.linkId)
            .is("used_at", null);
          if (linkErr) console.error("signing_links.update:", linkErr);
        }
      }
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
      actor_id: actor.userId,
      action: seal ? "cerrar_y_sellar" : complete ? "firmar_y_sellar" : "firmar",
      ip,
      metadata: {
        email: actor.email,
        signer_name: actor.name,
        signer_kind: actor.kind,
        user_agent: userAgent,
        dispositivo_repetido: actor.deviceReused || undefined,
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
    if (usoReservadoGlobal) {
      try {
        const admin2 = createClient(
          Deno.env.get("SUPABASE_URL")!,
          Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
        );
        await admin2.rpc("devolver_uso_de_enlace", {
          p_link_id: usoReservadoGlobal,
        });
      } catch (e2) {
        console.error("devolver_uso_de_enlace:", e2);
      }
    }
    return json(
      { error: err instanceof Error ? err.message : "Error al firmar" },
      500
    );
  }
});
