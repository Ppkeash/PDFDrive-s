// Edge Function: purge-trash
//
// Vacía la papelera de lo que ya cumplió su plazo: documentos con
// `deleted_at` de hace más de PURGE_TRASH_DIAS días. Borra el archivo de
// Storage y después la fila.
//
// Hace falta una función y no basta SQL: `pg_cron` puede borrar filas, pero no
// puede borrar objetos de Storage. Sin esto, cada documento que alguien
// mandara a la papelera dejaría su PDF en el bucket para siempre --invisible
// en la aplicación y sin forma de limpiarlo salvo entrando al panel.
//
// La llama la tarea programada `purgar-papelera` (migración 0022).
//
// La puerta es un Bearer que vive solo en Vault: la tarea lo lee de allí para
// llamar, y esta función le pregunta a la base si coincide
// (`es_secreto_de_purga`). Así el secreto no está copiado en las variables de
// la función, que es el sitio donde este proyecto ya tuvo un desencuentro
// entre dos formatos de clave.
//
// Variables:
//   PURGE_TRASH_DIAS     días en la papelera antes de borrar (por defecto 30)
//   PURGE_TRASH_LOTE     máximo de documentos por corrida (por defecto 100)

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

interface Fila {
  id: string;
  name: string;
  storage_path: string | null;
  signed_path: string | null;
  deleted_at: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  // La función corre sin usuario detrás (verify_jwt en false), así que este
  // Bearer es la única puerta. Lo valida la base, que es donde vive el
  // secreto; aquí no hay copia que se pueda quedar vieja.
  const auth = req.headers.get("Authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const { data: autorizado, error: errAuth } = await admin.rpc(
    "es_secreto_de_purga",
    { valor: token }
  );
  if (errAuth) return json({ error: errAuth.message }, 500);
  if (autorizado !== true) return json({ error: "No autorizado" }, 401);

  const dias = Number(Deno.env.get("PURGE_TRASH_DIAS") ?? "30");
  const lote = Number(Deno.env.get("PURGE_TRASH_LOTE") ?? "100");
  const limite = new Date(Date.now() - dias * 86_400_000).toISOString();

  const { data, error } = await admin
    .from("documents")
    .select("id, name, storage_path, signed_path, deleted_at")
    .not("deleted_at", "is", null)
    .lt("deleted_at", limite)
    .order("deleted_at", { ascending: true })
    .limit(lote);

  if (error) return json({ error: error.message }, 500);

  const filas = (data ?? []) as Fila[];
  if (filas.length === 0) return json({ ok: true, borrados: 0 });

  // Primero los archivos, después las filas. Al contrario, un fallo al borrar
  // el archivo dejaría un objeto que ya nadie nombra; en este orden, un fallo
  // deja la fila a la vista y la próxima corrida lo reintenta.
  const originales = filas.map((f) => f.storage_path).filter(Boolean) as string[];
  const firmados = filas.map((f) => f.signed_path).filter(Boolean) as string[];

  const problemas: string[] = [];

  if (originales.length > 0) {
    const { error: err } = await admin.storage
      .from("originals")
      .remove(originales);
    if (err) problemas.push(`originals: ${err.message}`);
  }
  if (firmados.length > 0) {
    const { error: err } = await admin.storage.from("signed").remove(firmados);
    if (err) problemas.push(`signed: ${err.message}`);
  }

  if (problemas.length > 0) {
    // Con el Storage a medias no se borran las filas: se deja todo como está
    // y se vuelve a intentar en la siguiente corrida.
    return json({ error: problemas.join("; "), borrados: 0 }, 500);
  }

  const { error: errFilas } = await admin
    .from("documents")
    .delete()
    .in(
      "id",
      filas.map((f) => f.id)
    );
  if (errFilas) return json({ error: errFilas.message, borrados: 0 }, 500);

  console.log(
    `[purge-trash] ${filas.length} documentos borrados definitivamente ` +
      `(más de ${dias} días en la papelera)`
  );

  return json({ ok: true, borrados: filas.length });
});
