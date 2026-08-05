import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { UploadButton } from "@/components/upload-button";
import { NewFolderButton } from "@/components/new-folder-button";
import { DocumentRow } from "@/components/document-row";
import { FolderCard } from "@/components/folder-card";
import { ChevronRight } from "lucide-react";
import type { DocStatus } from "@/types";

export default async function DrivePage({
  searchParams,
}: {
  searchParams: { carpeta?: string };
}) {
  const supabase = createClient();
  const folderId = searchParams.carpeta ?? null;

  // Todas las carpetas: hacen falta enteras para el diálogo de mover y para
  // reconstruir la ruta de migas.
  const { data: allFolders } = await supabase
    .from("folders")
    .select("id, name, parent_id")
    .order("name");
  const folders = allFolders ?? [];

  const current = folderId ? folders.find((f) => f.id === folderId) : null;
  // Carpeta inexistente (borrada o de otra cuenta): volver a la raíz.
  const activeId = current ? current.id : null;

  const docsQuery = supabase
    .from("documents")
    .select("id, name, status, storage_path, created_at, folder_id")
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  const { data: documents } = activeId
    ? await docsQuery.eq("folder_id", activeId)
    : await docsQuery.is("folder_id", null);

  const docs = documents ?? [];
  const children = folders.filter((f) => (f.parent_id ?? null) === activeId);

  const pendientes = docs.filter((d) => d.status === "en_firma").length;
  const firmados = docs.filter((d) => d.status === "firmado").length;

  // Migas: se sube por parent_id hasta la raíz.
  const trail: { id: string; name: string }[] = [];
  let node = current;
  while (node) {
    trail.unshift({ id: node.id, name: node.name });
    node = node.parent_id
      ? folders.find((f) => f.id === node!.parent_id)
      : undefined;
  }

  const folderOptions = folders.map((f) => ({ id: f.id, name: f.name }));

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
            {current ? current.name : "Mis documentos"}
          </h1>
          <p className="mt-1.5 text-sm text-muted">
            {docs.length === 0 && children.length === 0
              ? current
                ? "Esta carpeta está vacía."
                : "Todavía no has subido nada."
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
          <UploadButton folderId={activeId} />
        </div>
      </header>

      {children.length > 0 && (
        <ul className="mt-8 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {children.map((f) => (
            <FolderCard key={f.id} id={f.id} name={f.name} />
          ))}
        </ul>
      )}

      {docs.length === 0 ? (
        <EmptyState inFolder={!!current} />
      ) : (
        <ul className="mt-6 divide-y divide-line rounded-lg border border-line bg-surface">
          {docs.map((d) => (
            <DocumentRow
              key={d.id}
              id={d.id}
              name={d.name}
              status={d.status as DocStatus}
              storagePath={d.storage_path}
              createdAt={d.created_at}
              folderId={d.folder_id}
              folders={folderOptions}
            />
          ))}
        </ul>
      )}
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
          ? "Sube un PDF aquí, o mueve uno existente desde su menú de acciones."
          : "Sube un PDF para empezar a compartirlo y firmarlo. Cada firma queda registrada con su certificado y su huella."}
      </p>
    </div>
  );
}
