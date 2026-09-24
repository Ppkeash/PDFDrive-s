// Edge Function: send-emails
//
// Vacía `email_outbox` (ver migración 0014). Los triggers encolan; esto
// manda. Separarlo importa: que el proveedor de correo esté caído no puede
// hacer que compartir o firmar falle, y un aviso que no salió se reintenta en
// vez de perderse.
//
// El proveedor se elige con EMAIL_PROVIDER. Hoy toca SMTP porque el proyecto
// no tiene dominio propio y sin dominio verificado los servicios tipo Resend
// solo dejan escribirle a la cuenta del dueño. El día que haya dominio, se
// cambia la variable y nada más.
//
// Variables:
//   EMAIL_PROVIDER   'smtp' | 'resend'   (por defecto 'smtp')
//   EMAIL_FROM       remitente, p. ej. "FirmaDrive <avisos@ejemplo.com>"
//   SMTP_HOST SMTP_PORT SMTP_USER SMTP_PASS   (si EMAIL_PROVIDER=smtp)
//   RESEND_API_KEY                            (si EMAIL_PROVIDER=resend)
//   EMAIL_BATCH_SIZE máximo por corrida (por defecto 25)

import { createClient } from "npm:@supabase/supabase-js@2";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

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

interface Pendiente {
  id: string;
  to_email: string;
  subject: string;
  body_text: string;
  body_html: string | null;
  attempts: number;
  created_at: string;
}

// Los triggers encolan desde que se aplicó la migración, aunque todavía no
// haya proveedor configurado. Sin esto, el día que se conecte el envío
// saldría de golpe todo el atraso: "te pidieron firmar" de hace tres semanas,
// de documentos ya cerrados. Un aviso viejo confunde más de lo que ayuda.
const DIAS_ANTES_DE_DESCARTAR = 3;

/** Envoltura mínima en HTML. El texto plano manda: es el que siempre llega. */
function comoHtml(texto: string): string {
  const escapado = texto
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  const conEnlaces = escapado.replace(
    /(https?:\/\/[^\s]+)/g,
    '<a href="$1" style="color:#8a1c1c">$1</a>'
  );

  return `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.6;color:#1a1a1a;white-space:pre-wrap">${conEnlaces}</div>`;
}

async function enviarPorSmtp(p: Pendiente, from: string): Promise<void> {
  const host = Deno.env.get("SMTP_HOST");
  const user = Deno.env.get("SMTP_USER");
  const pass = Deno.env.get("SMTP_PASS");
  if (!host || !user || !pass) {
    throw new Error("Faltan SMTP_HOST, SMTP_USER o SMTP_PASS");
  }

  const port = Number(Deno.env.get("SMTP_PORT") ?? "465");

  const cliente = new SMTPClient({
    connection: {
      hostname: host,
      port,
      // 465 es TLS directo; 587 empieza en claro y sube con STARTTLS.
      tls: port === 465,
      auth: { username: user, password: pass },
    },
  });

  try {
    await cliente.send({
      from,
      to: p.to_email,
      subject: p.subject,
      content: p.body_text,
      html: p.body_html ?? comoHtml(p.body_text),
    });
  } finally {
    await cliente.close();
  }
}

async function enviarPorResend(p: Pendiente, from: string): Promise<void> {
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) throw new Error("Falta RESEND_API_KEY");

  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [p.to_email],
      subject: p.subject,
      text: p.body_text,
      html: p.body_html ?? comoHtml(p.body_text),
    }),
  });

  if (!r.ok) {
    throw new Error(`Resend respondió ${r.status}: ${await r.text()}`);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  // Solo la llama una tarea programada, con la service role key. No hay
  // camino desde el navegador.
  const auth = req.headers.get("Authorization") ?? "";
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  if (auth !== `Bearer ${service}`) {
    return json({ error: "No autorizado" }, 401);
  }

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, service);

  const proveedor = (Deno.env.get("EMAIL_PROVIDER") ?? "smtp").toLowerCase();
  const from = Deno.env.get("EMAIL_FROM");
  if (!from) return json({ error: "Falta EMAIL_FROM" }, 500);

  const limite = Number(Deno.env.get("EMAIL_BATCH_SIZE") ?? "25");

  const { data: pendientes, error } = await admin
    .from("email_outbox")
    .select("id, to_email, subject, body_text, body_html, attempts, created_at")
    .eq("status", "pendiente")
    .lte("scheduled_for", new Date().toISOString())
    .order("scheduled_for", { ascending: true })
    .limit(limite);

  if (error) return json({ error: error.message }, 500);
  if (!pendientes?.length) return json({ enviados: 0, fallidos: 0 });

  let enviados = 0;
  let fallidos = 0;
  let descartados = 0;

  const limiteAntiguedad =
    Date.now() - DIAS_ANTES_DE_DESCARTAR * 24 * 60 * 60 * 1000;

  for (const p of pendientes as Pendiente[]) {
    if (new Date(p.created_at).getTime() < limiteAntiguedad) {
      await admin
        .from("email_outbox")
        .update({
          status: "descartado",
          last_error: `Encolado hace mas de ${DIAS_ANTES_DE_DESCARTAR} dias`,
        })
        .eq("id", p.id);

      descartados++;
      continue;
    }

    try {
      if (proveedor === "resend") {
        await enviarPorResend(p, from);
      } else {
        await enviarPorSmtp(p, from);
      }

      await admin
        .from("email_outbox")
        .update({
          status: "enviado",
          sent_at: new Date().toISOString(),
          attempts: p.attempts + 1,
        })
        .eq("id", p.id);

      enviados++;
    } catch (e) {
      const intentos = p.attempts + 1;

      // Tras 5 intentos se deja de reintentar: si sigue fallando no es un
      // tropiezo del proveedor, y reintentar para siempre solo esconde el
      // problema. La fila queda con el error a la vista.
      const agotado = intentos >= 5;

      await admin
        .from("email_outbox")
        .update({
          status: agotado ? "fallido" : "pendiente",
          attempts: intentos,
          last_error: String(e instanceof Error ? e.message : e).slice(0, 500),
          // Espera creciente: 5, 10, 20, 40 minutos.
          scheduled_for: agotado
            ? undefined
            : new Date(Date.now() + 5 * 60 * 1000 * 2 ** (intentos - 1))
                .toISOString(),
        })
        .eq("id", p.id);

      fallidos++;
    }
  }

  return json({ enviados, fallidos, descartados, proveedor });
});
