"use server";

import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";

export interface CanjeResultado {
  ok: boolean;
  mensaje?: string;
}

/**
 * Canjea un código de invitación y deja habilitado ese correo para
 * registrarse (ver migración `0013`). Se hace aquí, en el servidor, para
 * poder adjuntar la IP del cliente: la función de base la usa como freno de
 * fuerza bruta, nunca para decidir quién pasa.
 */
export async function canjearCodigo(
  codigo: string,
  email: string
): Promise<CanjeResultado> {
  const limpio = email.trim().toLowerCase();
  if (!codigo.trim() || !limpio) {
    return { ok: false, mensaje: "Faltan el código o el correo." };
  }

  // En Vercel esta cabecera la pone la plataforma con la IP real.
  const ip = headers().get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;

  const supabase = createClient();
  const { data, error } = await supabase.rpc("redeem_signup_code", {
    p_code: codigo.trim(),
    p_email: limpio,
    p_ip: ip,
  });

  if (error) {
    return { ok: false, mensaje: "No se pudo validar el código ahora mismo." };
  }

  const respuesta = data as { ok: boolean; motivo?: string } | null;
  if (respuesta?.ok) return { ok: true };

  if (respuesta?.motivo === "demasiados_intentos") {
    return {
      ok: false,
      mensaje: "Demasiados intentos seguidos. Espera unos minutos.",
    };
  }

  // La base responde igual ante código malo, vencido, agotado o correo
  // inválido, para no confirmarle nada a quien esté probando códigos.
  return {
    ok: false,
    mensaje: "El código no sirve o el correo no es válido. Revísalos.",
  };
}
