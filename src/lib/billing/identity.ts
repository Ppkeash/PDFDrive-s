import { createHmac } from "node:crypto";

/** IP no es identidad: oficinas, universidades y hogares la comparten. */
export type BillingIdentityKind =
  | "email_canonical"
  | "verified_phone"
  | "payment_method"
  | "device_cookie";

/**
 * Normalización usada exclusivamente para decidir elegibilidad gratuita.
 * El correo real de acceso nunca debe sustituirse por este valor.
 */
export function canonicalizeEmailForBilling(email: string): string {
  const normalized = email.trim().normalize("NFKC").toLowerCase();
  const at = normalized.lastIndexOf("@");
  if (at <= 0 || at === normalized.length - 1) return normalized;

  let local = normalized.slice(0, at);
  let domain = normalized.slice(at + 1);

  // Los sufijos +tag se usan normalmente como alias del mismo buzón.
  local = local.split("+", 1)[0];

  // Gmail además ignora puntos y trata googlemail.com como el mismo dominio.
  if (domain === "gmail.com" || domain === "googlemail.com") {
    local = local.replaceAll(".", "");
    domain = "gmail.com";
  }

  return `${local}@${domain}`;
}

function canonicalizeIdentity(kind: BillingIdentityKind, value: string): string {
  if (kind === "email_canonical") return canonicalizeEmailForBilling(value);
  if (kind === "verified_phone") return value.replace(/[^\d+]/g, "");
  return value.trim();
}

/**
 * Devuelve una huella HMAC; la base nunca recibe correo, teléfono, cookie ni
 * identificador de tarjeta en claro. El secreto debe vivir solo en backend.
 */
export function fingerprintBillingIdentity(
  kind: BillingIdentityKind,
  value: string,
  secret: string
): string {
  if (secret.length < 32) {
    throw new Error("BILLING_IDENTITY_SECRET debe tener al menos 32 caracteres");
  }

  const canonical = canonicalizeIdentity(kind, value);
  return createHmac("sha256", secret)
    .update(`${kind}:${canonical}`, "utf8")
    .digest("hex");
}
