import { createClient } from "@/lib/supabase/server";
import { UploadButton } from "@/components/upload-button";
import { NewFolderButton } from "@/components/new-folder-button";
import { DocumentRow } from "@/components/document-row";
import { Folder } from "lucide-react";
import type { DocStatus } from "@/types";

export default async function DrivePage() {
  const supabase = createClient();

  const [{ data: folders }, { data: documents }] = await Promise.all([
    supabase.from("folders").select("id, name").order("name"),
    supabase
      .from("documents")
      .select("id, name, status, storage_path, created_at")
      .is("deleted_at", null)
      .order("created_at", { ascending: false }),
  ]);

  const docs = documents ?? [];
  const pendientes = docs.filter((d) => d.status === "en_firma").length;
  const firmados = docs.filter((d) => d.status === "firmado").length;

  return (
    <div className="mx-auto max-w-4xl px-5 py-8 sm:px-8 sm:py-10">
      <header className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="font-display text-3xl font-semibold">Mis documentos</h1>
          {/* El resumen va antes del detalle: qué necesita atención. */}
          <p className="mt-1.5 text-sm text-muted">
            {docs.length === 0
              ? "Todavía no has subido nada."
              : `${docs.length} ${docs.length === 1 ? "documento" : "documentos"}` +
                (pendientes ? ` · ${pendientes} en firma` : "") +
                (firmados ? ` · ${firmados} firmados` : "")}
          </p>
        </div>
        <div className="flex shrink-0 items-start gap-2">
          <NewFolderButton />
          <UploadButton />
        </div>
      </header>

      {folders && folders.length > 0 && (
        <ul className="mt-8 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {folders.map((f) => (
            <li
              key={f.id}
              className="flex items-center gap-2.5 rounded border border-line bg-surface px-3.5 py-3 text-sm"
            >
              <Folder className="h-4 w-4 shrink-0 text-muted" />
              <span className="truncate">{f.name}</span>
            </li>
          ))}
        </ul>
      )}

      {docs.length === 0 ? (
        <EmptyState />
      ) : (
        <ul className="mt-6 divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
          {docs.map((d) => (
            <DocumentRow
              key={d.id}
              id={d.id}
              name={d.name}
              status={d.status as DocStatus}
              storagePath={d.storage_path}
              createdAt={d.created_at}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function EmptyState() {
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
        Aquí irán tus documentos
      </h2>
      <p className="mt-1.5 max-w-sm text-sm text-muted">
        Sube un PDF para empezar a compartirlo y firmarlo. Cada firma queda
        registrada con su certificado y su huella.
      </p>
    </div>
  );
}
