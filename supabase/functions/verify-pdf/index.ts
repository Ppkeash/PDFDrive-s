// Edge Function: verify-pdf
//
// Verificación criptográfica real de la firma incrustada en el PDF:
//
//   1. Localiza cada /ByteRange y reconstruye exactamente los bytes firmados.
//   2. Extrae el PKCS#7 (CMS) de /Contents.
//   3. Comprueba que el messageDigest firmado coincide con el digest que
//      calculamos ahora sobre esos bytes  → detecta cualquier modificación.
//   4. Verifica la firma de los atributos autenticados contra la clave pública
//      del certificado          → demuestra que la hizo quien dice el cert.
//   5. Comprueba que el ByteRange cubre TODO el archivo salvo el hueco de la
//      firma → detecta contenido añadido después de firmar.
//
// Lo que todavía NO hace: validar la cadena del certificado contra una CA de
// confianza (el actual es autofirmado de desarrollo) ni un sello de tiempo TSA.

import { createClient } from "npm:@supabase/supabase-js@2";
import forge from "npm:node-forge@1";

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

/**
 * Convierte los bytes a la cadena binaria que espera node-forge (un carácter
 * por byte).
 *
 * No se usa TextDecoder("latin1") a propósito: según el estándar WHATWG esa
 * etiqueta resuelve a windows-1252, que remapea los bytes 0x80–0x9F a otros
 * puntos Unicode. Eso corrompe el contenido justo antes de calcular el digest
 * y hacía que un PDF intacto se reportara como alterado.
 */
function toBinaryString(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let out = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    out += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return out;
}

const DIGEST_BY_OID: Record<string, () => forge.md.MessageDigest> = {
  "2.16.840.1.101.3.4.2.1": () => forge.md.sha256.create(),
  "2.16.840.1.101.3.4.2.2": () => forge.md.sha384.create(),
  "2.16.840.1.101.3.4.2.3": () => forge.md.sha512.create(),
  "1.3.14.3.2.26": () => forge.md.sha1.create(),
};

type SigReport = {
  valid: boolean;
  digestMatch: boolean;
  signatureValid: boolean;
  coversWholeFile: boolean;
  subject: string | null;
  issuer: string | null;
  signedAt: string | null;
  validFrom: string | null;
  validTo: string | null;
  selfSigned: boolean;
  problem?: string;
};

function nameToString(attrs: forge.pki.CertificateField[]): string {
  return attrs
    .map((a) => `${a.shortName ?? a.name}=${a.value}`)
    .join(", ");
}

/** Verifica una firma concreta a partir de su /ByteRange. */
function verifyOne(
  bytes: Uint8Array,
  latin1: string,
  range: [number, number, number, number]
): SigReport {
  const [a, b, c, d] = range;
  const report: SigReport = {
    valid: false,
    digestMatch: false,
    signatureValid: false,
    coversWholeFile: a === 0 && c + d === bytes.length,
    subject: null,
    issuer: null,
    signedAt: null,
    validFrom: null,
    validTo: null,
    selfSigned: false,
  };

  try {
    // Los bytes realmente firmados: todo el archivo menos el hueco de /Contents.
    const signedContent = latin1.slice(a, a + b) + latin1.slice(c, c + d);

    // El hueco contiene el PKCS#7 en hexadecimal, relleno con ceros al final.
    const rawGap = latin1.slice(a + b, c);
    const hex = rawGap
      .replace(/[<>\s]/g, "")
      .replace(/(00)+$/, "");
    if (!hex) {
      report.problem = "No se encontró el contenido de la firma.";
      return report;
    }

    const der = forge.util.hexToBytes(hex);
    const asn1 = forge.asn1.fromDer(der, false);
    // deno-lint-ignore no-explicit-any
    const p7: any = forge.pkcs7.messageFromAsn1(asn1);
    const capture = p7.rawCapture;

    const digestOid = forge.asn1.derToOid(capture.digestAlgorithm);
    const makeDigest = DIGEST_BY_OID[digestOid];
    if (!makeDigest) {
      report.problem = `Algoritmo de digest no soportado (${digestOid}).`;
      return report;
    }

    // --- 1. ¿El documento cambió desde que se firmó? ---
    const md = makeDigest();
    md.update(signedContent);
    const computed = md.digest().getBytes();

    const authAttrs = capture.authenticatedAttributes ?? [];
    let declared: string | null = null;

    for (const attr of authAttrs) {
      const oid = forge.asn1.derToOid(attr.value[0].value);
      if (oid === forge.pki.oids.messageDigest) {
        declared = attr.value[1].value[0].value;
      } else if (oid === forge.pki.oids.signingTime) {
        const raw = attr.value[1].value[0].value;
        const parsed =
          raw instanceof Date ? raw : new Date(String(raw));
        if (!isNaN(parsed.getTime())) report.signedAt = parsed.toISOString();
      }
    }

    if (declared === null) {
      report.problem = "La firma no declara messageDigest.";
      return report;
    }
    report.digestMatch = declared === computed;

    // --- 2. ¿La firma la hizo el titular del certificado? ---
    const cert = p7.certificates?.[0];
    if (!cert) {
      report.problem = "La firma no incluye certificado.";
      return report;
    }

    report.subject = nameToString(cert.subject.attributes);
    report.issuer = nameToString(cert.issuer.attributes);
    report.validFrom = cert.validity.notBefore?.toISOString() ?? null;
    report.validTo = cert.validity.notAfter?.toISOString() ?? null;
    report.selfSigned = report.subject === report.issuer;

    // La firma cubre el DER de los atributos autenticados, reetiquetados
    // como SET (en el PDF viajan con etiqueta implícita [0]).
    const attrsSet = forge.asn1.create(
      forge.asn1.Class.UNIVERSAL,
      forge.asn1.Type.SET,
      true,
      authAttrs
    );
    const attrsDer = forge.asn1.toDer(attrsSet).getBytes();

    const mdAttrs = makeDigest();
    mdAttrs.update(attrsDer);

    try {
      report.signatureValid = cert.publicKey.verify(
        mdAttrs.digest().getBytes(),
        capture.signature
      );
    } catch {
      report.signatureValid = false;
    }

    report.valid =
      report.digestMatch && report.signatureValid && report.coversWholeFile;
    return report;
  } catch (err) {
    report.problem =
      err instanceof Error ? err.message : "No se pudo analizar la firma.";
    return report;
  }
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
      return json({
        state: "sin_firmar",
        valid: false,
        reason: "Todavía nadie ha firmado este documento.",
      });

    if (doc.status !== "firmado")
      return json({
        state: "sin_sellar",
        valid: false,
        reason:
          "Hay rúbricas estampadas, pero el documento aún no está sellado: falta que firmen los campos pendientes.",
      });

    const admin = createClient(url, service);
    const { data: file, error: dlErr } = await admin.storage
      .from("signed")
      .download(doc.signed_path);
    if (dlErr || !file)
      return json({ error: "No se pudo leer el PDF firmado" }, 500);

    const bytes = new Uint8Array(await file.arrayBuffer());
    const latin1 = toBinaryString(bytes);

    // Localizar cada firma incrustada.
    const ranges: [number, number, number, number][] = [];
    const re = /\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/g;
    for (const m of latin1.matchAll(re)) {
      ranges.push([+m[1], +m[2], +m[3], +m[4]]);
    }

    if (ranges.length === 0)
      return json({
        state: "sin_firma_digital",
        valid: false,
        reason: "El PDF no lleva ninguna firma digital incrustada.",
      });

    const signatures = ranges.map((r) => verifyOne(bytes, latin1, r));
    const allValid = signatures.every((s) => s.valid);

    const { data: signers } = await asUser
      .from("signatures")
      .select("signer_id, signed_at, cert_subject")
      .eq("document_id", doc.id)
      .order("signed_at");

    const { data: audit } = await asUser
      .from("audit_log")
      .select("action, actor_id, created_at, metadata")
      .eq("document_id", doc.id)
      .order("created_at");

    return json({
      state: allValid ? "valido" : "alterado",
      valid: allValid,
      signatures,
      signatureCount: signatures.length,
      // Referencia cruzada con lo que registramos al sellar.
      currentHash: await sha256Hex(bytes),
      registeredHash: doc.current_hash,
      signers: signers ?? [],
      audit: audit ?? [],
      caveat: signatures.some((s) => s.selfSigned)
        ? "El certificado es autofirmado (desarrollo): prueba integridad y autoría dentro de FirmaDrive, pero no la identidad ante terceros."
        : null,
    });
  } catch (err) {
    console.error("verify-pdf:", err);
    return json(
      { error: err instanceof Error ? err.message : "Error al verificar" },
      500
    );
  }
});
