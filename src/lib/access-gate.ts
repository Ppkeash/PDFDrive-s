/**
 * Puerta de acceso: la aplicación no debe ser encontrable ni utilizable desde
 * fuera de la empresa.
 *
 * Dos vías de entrada, ninguna excluyente:
 *   1. La IP pública sale en `ACCESS_ALLOWED_IPS` (la oficina).
 *   2. El navegador trae una cookie firmada, que se obtiene abriendo
 *      cualquier URL con `?acceso=<frase>` una sola vez (gente en casa).
 *
 * Quien no cumple ninguna recibe 404 -- nunca 403. Un 403 confirma que aquí
 * hay algo; el 404 no dice nada.
 *
 * Esto tapa el frontend, NO la API de Supabase: la anon key viaja en el bundle
 * del navegador y `*.supabase.co` sigue siendo público. Lo que protege los
 * datos de verdad es RLS. Esta puerta es cortina, no cerradura.
 */
import type { NextRequest } from "next/server";

export const ACCESS_COOKIE = "fd_acceso";
const QUERY_PARAM = "acceso";

/** Sin secreto o sin frase no hay puerta que valga: se deja pasar todo. */
export function gateEnabled(): boolean {
  if (process.env.ACCESS_GATE_ENABLED !== "true") return false;
  return Boolean(process.env.ACCESS_COOKIE_SECRET && secretIsUsable());
}

function secretIsUsable(): boolean {
  return (process.env.ACCESS_COOKIE_SECRET ?? "").length >= 32;
}

function cookieMaxAgeSeconds(): number {
  const days = Number(process.env.ACCESS_COOKIE_DAYS ?? 30);
  const safe = Number.isFinite(days) && days > 0 ? days : 30;
  return Math.round(safe * 24 * 60 * 60);
}

/**
 * IP del cliente. En Vercel `request.ip` es la fiable: la plataforma la pone y
 * no se puede falsificar desde fuera. Las cabeceras son el respaldo para otros
 * despliegues -- ahí sí son falsificables si no hay un proxy que las reescriba.
 */
export function clientIp(request: NextRequest): string | null {
  if (request.ip) return request.ip;

  const real = request.headers.get("x-real-ip");
  if (real) return real.trim();

  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();

  return null;
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;

  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const byte = Number(part);
    if (byte > 255) return null;
    value = value * 256 + byte;
  }
  return value;
}

/** Acepta IP exacta (v4 o v6) y rango CIDR v4, que es lo que da un ISP fijo. */
function matchesRule(ip: string, rule: string): boolean {
  if (!rule) return false;
  if (rule === ip) return true;
  if (!rule.includes("/")) return false;

  const [network, bitsRaw] = rule.split("/");
  const bits = Number(bitsRaw);
  if (!Number.isInteger(bits) || bits < 0 || bits > 32) return false;

  const networkInt = ipv4ToInt(network!);
  const ipInt = ipv4ToInt(ip);
  if (networkInt === null || ipInt === null) return false;

  // `>>> 0` mantiene el resultado sin signo; con /0 el desplazamiento de 32
  // no corre en JS, así que ese caso se resuelve aparte.
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (networkInt & mask) === (ipInt & mask);
}

export function ipIsAllowed(ip: string | null): boolean {
  if (!ip) return false;

  const rules = (process.env.ACCESS_ALLOWED_IPS ?? "")
    .split(",")
    .map((r) => r.trim())
    .filter(Boolean);

  return rules.some((rule) => matchesRule(ip, rule));
}

/** Comparación en tiempo constante: no filtra la frase carácter a carácter. */
function equalsConstantTime(a: string, b: string): boolean {
  if (a.length !== b.length) return false;

  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function passphraseMatches(candidate: string): boolean {
  const expected = process.env.ACCESS_PASSPHRASE ?? "";
  if (expected.length === 0) return false;
  return equalsConstantTime(candidate, expected);
}

/** Lee `?acceso=` sin dejarlo en el historial: quien lo use será redirigido. */
export function passphraseFromRequest(request: NextRequest): string | null {
  return request.nextUrl.searchParams.get(QUERY_PARAM);
}

export function stripPassphrase(url: URL): URL {
  const clean = new URL(url.toString());
  clean.searchParams.delete(QUERY_PARAM);
  return clean;
}

// El middleware corre en el runtime Edge: no hay `node:crypto`, solo WebCrypto.
async function hmac(payload: string): Promise<string> {
  const secret = process.env.ACCESS_COOKIE_SECRET!;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payload)
  );

  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * La cookie lleva su propia caducidad firmada. Sin esto bastaría con que el
 * navegador conservara el valor para entrar para siempre.
 */
export async function issueAccessCookie(): Promise<{
  value: string;
  maxAge: number;
}> {
  const maxAge = cookieMaxAgeSeconds();
  const expiresAt = Date.now() + maxAge * 1000;
  const signature = await hmac(String(expiresAt));

  return { value: `${expiresAt}.${signature}`, maxAge };
}

export async function accessCookieIsValid(
  value: string | undefined
): Promise<boolean> {
  if (!value) return false;

  const separator = value.lastIndexOf(".");
  if (separator <= 0) return false;

  const expiresAt = Number(value.slice(0, separator));
  const signature = value.slice(separator + 1);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return false;

  return equalsConstantTime(signature, await hmac(String(expiresAt)));
}
