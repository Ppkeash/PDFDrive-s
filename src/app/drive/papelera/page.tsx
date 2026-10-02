import { createClient } from "@/lib/supabase/server";
import { TrashRow } from "@/components/trash-row";
import { Trash2 } from "lucide-react";
import {
  agruparPorFecha,
  diasDesde,
  etiquetaDeFecha,
  formatearFechaHora,
} from "@/lib/fechas";
import { rutaLegible, type Carpeta } from "@/lib/carpetas";
import { DIAS_EN_PAPELERA } from "@/lib/papelera";
import type { DocStatus } from "@/types";

/**
 * La papelera.
 *
 * El borrado ya era reversible por dentro --`softDeleteDocument` solo marca
 * `deleted_at`-- pero no había ninguna pantalla para verlo ni para
 * restaurarlo: un acta borrada por error solo se recuperaba entrando a la
 * base de datos. Eso para un documento firmado es inaceptable.
 */
export default async function PapeleraPage() {
  const supabase = createClient();

  const { data: allFolders } = await supabase
    .from("folders")
    .select("id, name, parent_id")
    .order("name");
  const folders: Carpeta[] = allFolders ?? [];

  const { data: documents } = await supabase
    .from("documents")
    .select("id, name, status, folder_id, deleted_at")
    .not("deleted_at", "is", null)
    .order("deleted_at", { ascending: false })
    .limit(500);

  const docs = (documents ?? []).filter(
    (d): d is typeof d & { deleted_at: string } => Boolean(d.deleted_at)
  );

  const grupos = agruparPorFecha(docs, (d) => d.deleted_at);

  return (
    <div className="mx-auto max-w-4xl px-5 py-8 sm:px-8 sm:py-10">
      <header>
        <h1 className="font-display text-3xl font-semibold">Papelera</h1>
        <p className="mt-1.5 text-sm text-muted">
          {docs.length === 0
            ? "No hay nada en la papelera."
            : `${docs.length} ${docs.length === 1 ? "documento" : "documentos"}. Se eliminan solos a los ${DIAS_EN_PAPELERA} días de haber entrado aquí.`}
        </p>
        {docs.length > 0 && (
          <p className="mt-1 text-xs text-muted">
            Nada de esto ocupa cupo de tu plan: el cupo cuenta documentos
            firmados en el mes, no archivos guardados.
          </p>
        )}
      </header>

      {docs.length === 0 ? (
        <div className="mt-8 flex flex-col items-center rounded-lg border border-dashed border-line-strong bg-surface px-6 py-16 text-center">
          <Trash2 className="h-10 w-10 text-line-strong" aria-hidden />
          <h2 className="mt-4 font-display text-lg font-semibold">
            La papelera está vacía
          </h2>
          <p className="mt-1.5 max-w-sm text-sm text-muted">
            Lo que envíes a la papelera desde el Drive aparece aquí, y se puede
            restaurar hasta que se elimine definitivamente.
          </p>
        </div>
      ) : (
        <div className="mt-8 overflow-hidden rounded-lg border border-line bg-surface">
          {grupos.map((grupo) => (
            <section key={grupo.clave}>
              <h2 className="border-b border-line bg-surface-2 px-4 py-2 text-micro uppercase text-muted sm:px-5">
                Borrado · {grupo.titulo}
              </h2>
              <ul className="divide-y divide-line">
                {grupo.items.map((d) => (
                  <TrashRow
                    key={d.id}
                    id={d.id}
                    name={d.name}
                    status={d.status as DocStatus}
                    cuando={etiquetaDeFecha(d.deleted_at)}
                    fechaCompleta={formatearFechaHora(d.deleted_at)}
                    ruta={rutaLegible(folders, d.folder_id)}
                    diasParaPurga={
                      DIAS_EN_PAPELERA - diasDesde(d.deleted_at)
                    }
                  />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
