import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Uploader } from "@/components/uploader";
import { NewFolderButton } from "@/components/new-folder-button";
import { FolderCard } from "@/components/folder-card";
import { DriveToolbar } from "@/components/drive-toolbar";
import { DocumentList, type DocItem, type GrupoDocs } from "@/components/document-list";
import { ChevronRight, SearchX } from "lucide-react";
import { PlanBanner, type Cupo } from "@/components/plan-banner";
import {
  agruparPorFecha,
  etiquetaDeFecha,
  formatearFechaHora,
  inicioDelDia,
  normalizarBusqueda,
} from "@/lib/fechas";
import { hijasDe, rutaDeCarpeta, rutaLegible, type Carpeta } from "@/lib/carpetas";
import type { DocStatus } from "@/types";

const ESTADOS_VALIDOS = ["borrador", "en_firma", "firmado", "archivado"];
const ORDENES_VALIDOS = ["reciente", "antiguo", "nombre", "estado"];

/** Techo de filas por pantalla. Con más, lo que hace falta es filtrar. */
const MAX_FILAS = 500;

export default async function DrivePage({
  searchParams,
}: {
  searchParams: {
    carpeta?: string;
    q?: string;
    estado?: string;
    desde?: string;
    orden?: string;
    enCarpeta?: string;
  };
}) {
  const supabase = createClient();

  const q = (searchParams.q ?? "").trim();
  const estado = ESTADOS_VALIDOS.includes(searchParams.estado ?? "")
    ? searchParams.estado!
    : null;
  const desde = ["hoy", "7", "30"].includes(searchParams.desde ?? "")
    ? searchParams.desde!
    : null;
  const orden = ORDENES_VALIDOS.includes(searchParams.orden ?? "")
    ? searchParams.orden!
    : "reciente";
  const soloAqui = searchParams.enCarpeta === "1";

  // Todas las carpetas: hacen falta enteras para el diálogo de mover, para la
  // ruta de migas y para decir en qué carpeta cayó cada resultado al buscar.
  const { data: allFolders } = await supabase
    .from("folders")
    .select("id, name, parent_id")
    .order("name");
  const folders: Carpeta[] = allFolders ?? [];

  const folderId = searchParams.carpeta ?? null;
  const current = folderId ? folders.find((f) => f.id === folderId) : null;
  // Carpeta inexistente (borrada o de otra cuenta): volver a la raíz.
  const activeId = current ? current.id : null;

  const buscando = q.length > 0;
  const filtrando = buscando || !!estado || !!desde;

  let consulta = supabase
    .from("documents")
    .select("id, name, status, storage_path, created_at, folder_id")
    .is("deleted_at", null);

  // Buscar mira toda la cuenta: si uno busca "acta de agosto" no quiere que
  // la carpeta en la que estaba parado se la esconda. El chip "solo en esta
  // carpeta" existe para cuando sí se quiere lo contrario.
  if (!buscando || soloAqui) {
    consulta = activeId
      ? consulta.eq("folder_id", activeId)
      : consulta.is("folder_id", null);
  }

  if (buscando) {
    // `name_norm` es `lower(f_unaccent(name))` en la base, y
    // `normalizarBusqueda` hace lo mismo aquí: así "accion" encuentra
    // "Acción". Los comodines se quitan para que no cambien la consulta.
    const patron = normalizarBusqueda(q).replace(/[%_*]/g, "");
    consulta = consulta.ilike("name_norm", `%${patron}%`);
  }

  if (estado) consulta = consulta.eq("status", estado);
  if (desde)
    consulta = consulta.gte(
      "created_at",
      inicioDelDia(desde === "hoy" ? 0 : Number(desde))
    );

  if (orden === "antiguo") consulta = consulta.order("created_at");
  else if (orden === "nombre") consulta = consulta.order("name_norm");
  else if (orden === "estado")
    consulta = consulta
      .order("status")
      .order("created_at", { ascending: false });
  else consulta = consulta.order("created_at", { ascending: false });

  const { data: documents } = await consulta.limit(MAX_FILAS);
  const docs = documents ?? [];

  // Las carpetas desaparecen mientras se busca: un resultado de búsqueda es
  // una lista de documentos, no un sitio donde estar.
  const children = buscando ? [] : hijasDe(folders, activeId);

  // Qué hay dentro de cada carpeta, de una sola consulta.
  const conteos = new Map<string, { documentos: number; enFirma: number }>();
  if (children.length > 0) {
    const { data: dentro } = await supabase
      .from("documents")
      .select("folder_id, status")
      .is("deleted_at", null)
      .in(
        "folder_id",
        children.map((c) => c.id)
      );
    for (const d of dentro ?? []) {
      if (!d.folder_id) continue;
      const acc = conteos.get(d.folder_id) ?? { documentos: 0, enFirma: 0 };
      acc.documentos++;
      if (d.status === "en_firma") acc.enFirma++;
      conteos.set(d.folder_id, acc);
    }
  }

  const aItem = (d: (typeof docs)[number]): DocItem => ({
    id: d.id,
    name: d.name,
    status: d.status as DocStatus,
    storagePath: d.storage_path,
    cuando: etiquetaDeFecha(d.created_at),
    fechaCompleta: formatearFechaHora(d.created_at),
    folderId: d.folder_id,
    // Al buscar fuera de la carpeta actual, el nombre suelto no dice dónde
    // está el documento, y encontrarlo sin saber dónde vive no sirve de mucho.
    ruta: buscando ? rutaLegible(folders, d.folder_id) : null,
  });

  // Se agrupa por fecha cuando la lista es "todo lo que hay, por fecha". Con
  // un filtro puesto o con otro orden, los encabezados de fecha estorban más
  // de lo que ayudan.
  const agrupaPorFecha =
    !filtrando && (orden === "reciente" || orden === "antiguo");

  const grupos: GrupoDocs[] = agrupaPorFecha
    ? agruparPorFecha(docs, (d) => d.created_at).map((g) => ({
        clave: g.clave,
        titulo: g.titulo,
        items: g.items.map(aItem),
      }))
    : [{ clave: "todos", titulo: "", items: docs.map(aItem) }];

  const folderOptions = folders.map((f) => ({
    id: f.id,
    name: f.name,
    ruta: rutaLegible(folders, f.parent_id),
  }));

  const trail = rutaDeCarpeta(folders, activeId);
  const destinoAlBorrar = activeId
    ? (current?.name ?? "Mis documentos")
    : "Mis documentos";

  // El cupo lo resuelve la base a partir de la sesión: el cliente no puede
  // preguntar por el espacio de otro. Si falla, el Drive se muestra igual --
  // un aviso de plan no vale romper la pantalla principal.
  const { data: cupoRaw } = await supabase.rpc("mi_cupo_de_documentos");
  const cupo = (cupoRaw as Cupo | null) ?? null;

  const pendientes = docs.filter((d) => d.status === "en_firma").length;
  const firmados = docs.filter((d) => d.status === "firmado").length;

  return (
    <div className="mx-auto max-w-4xl px-5 py-8 sm:px-8 sm:py-10">
      <header className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          {trail.length > 0 && (
            <nav
              aria-label="Ruta"
              className="mb-1.5 flex flex-wrap items-center gap-1 text-sm text-muted"
            >
              <Link href="/drive" className="hover:text-ink">
                Mis documentos
              </Link>
              {trail.map((t, i) => (
                <span key={t.id} className="flex items-center gap-1">
                  <ChevronRight className="h-3.5 w-3.5" aria-hidden />
                  {i === trail.length - 1 ? (
                    <span className="text-ink">{t.name}</span>
                  ) : (
                    <Link
                      href={`/drive?carpeta=${t.id}`}
                      className="hover:text-ink"
                    >
                      {t.name}
                    </Link>
                  )}
                </span>
              ))}
            </nav>
          )}

          <h1 className="truncate font-display text-3xl font-semibold">
            {buscando
              ? "Resultados"
              : current
                ? current.name
                : "Mis documentos"}
          </h1>
          <p className="mt-1.5 text-sm text-muted">
            {buscando
              ? `${docs.length} ${docs.length === 1 ? "documento" : "documentos"} para «${q}»${soloAqui && current ? ` en ${current.name}` : " en toda la cuenta"}`
              : docs.length === 0 && children.length === 0
                ? filtrando
                  ? "Ningún documento coincide con los filtros."
                  : current
                    ? "Esta carpeta está vacía."
                    : "Aún no has subido documentos."
                : [
                    docs.length > 0 &&
                      `${docs.length} ${docs.length === 1 ? "documento" : "documentos"}`,
                    children.length > 0 &&
                      `${children.length} ${children.length === 1 ? "carpeta" : "carpetas"}`,
                    pendientes > 0 && `${pendientes} en firma`,
                    firmados > 0 && `${firmados} firmados`,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
          </p>
        </div>

        <div className="flex shrink-0 items-start gap-2">
          <NewFolderButton parentId={activeId} />
          <Uploader folderId={activeId} folderName={current?.name ?? null} />
        </div>
      </header>

      <PlanBanner cupo={cupo} />

      <DriveToolbar
        carpetaActual={activeId}
        hayCarpetas={folders.length > 0}
      />

      {children.length > 0 && (
        <ul className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {children.map((f) => (
            <FolderCard
              key={f.id}
              id={f.id}
              name={f.name}
              documentos={conteos.get(f.id)?.documentos ?? 0}
              enFirma={conteos.get(f.id)?.enFirma ?? 0}
              subcarpetas={hijasDe(folders, f.id).length}
              destinoAlBorrar={destinoAlBorrar}
            />
          ))}
        </ul>
      )}

      {docs.length === 0 ? (
        filtrando ? (
          <SinResultados />
        ) : (
          <EmptyState inFolder={!!current} />
        )
      ) : (
        <DocumentList
          grupos={grupos}
          folders={folderOptions}
          carpetaActual={activeId}
        />
      )}

      {docs.length === MAX_FILAS && (
        <p className="mt-4 text-xs text-muted">
          Se muestran los primeros {MAX_FILAS}. Usa el buscador o los filtros
          para acotar.
        </p>
      )}
    </div>
  );
}

function SinResultados() {
  return (
    <div className="mt-6 flex flex-col items-center rounded-lg border border-dashed border-line-strong bg-surface px-6 py-14 text-center">
      <SearchX className="h-10 w-10 text-line-strong" aria-hidden />
      <h2 className="mt-4 font-display text-lg font-semibold">
        Nada coincide
      </h2>
      <p className="mt-1.5 max-w-sm text-sm text-muted">
        Prueba con menos palabras, o quita alguno de los filtros de arriba.
      </p>
    </div>
  );
}

function EmptyState({ inFolder }: { inFolder: boolean }) {
  return (
    <div className="mt-6 flex flex-col items-center rounded-lg border border-dashed border-line-strong bg-surface px-6 py-16 text-center">
      <svg viewBox="0 0 48 56" className="h-14 w-12 text-line-strong" aria-hidden>
        <path
          d="M2 2h28l16 16v36H2z"
          fill="rgb(var(--surface-2))"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
        <path
          d="M30 2v16h16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
        <path
          d="M11 30h26M11 37h26M11 44h16"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          opacity="0.5"
        />
      </svg>
      <h2 className="mt-5 font-display text-lg font-semibold">
        {inFolder ? "Carpeta sin documentos" : "Aquí irán tus documentos"}
      </h2>
      <p className="mt-1.5 max-w-sm text-sm text-muted">
        {inFolder
          ? "Suelta aquí los PDF que vayan en esta carpeta, o mueve alguno existente desde su menú de acciones."
          : "Suelta tus PDF en esta pantalla, o usa el botón de subir. Puedes soltar varios a la vez. Cada firma queda registrada con su certificado y su huella."}
      </p>
    </div>
  );
}
