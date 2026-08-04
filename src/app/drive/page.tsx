import { createClient } from "@/lib/supabase/server";
import { FileUp, Folder } from "lucide-react";
import { UploadButton } from "@/components/upload-button";
import { NewFolderButton } from "@/components/new-folder-button";
import { DocumentRow } from "@/components/document-row";
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

  return (
    <div className="mx-auto max-w-5xl p-4 sm:p-6">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Mis documentos</h1>
          <p className="text-sm text-muted-foreground">
            Sube, organiza y firma tus PDF y documentos.
          </p>
        </div>
        <div className="flex items-start gap-2">
          <NewFolderButton />
          <UploadButton />
        </div>
      </div>

      {folders && folders.length > 0 && (
        <ul className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {folders.map((f) => (
            <li
              key={f.id}
              className="flex items-center gap-2 rounded-lg border p-3 text-sm"
            >
              <Folder className="h-4 w-4 text-primary" />
              <span className="truncate">{f.name}</span>
            </li>
          ))}
        </ul>
      )}

      {!documents || documents.length === 0 ? (
        <EmptyState />
      ) : (
        <ul className="divide-y rounded-xl border">
          {documents.map((d) => (
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
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-16 text-center">
      <FileUp className="mb-3 h-8 w-8 text-muted-foreground" />
      <p className="font-medium">Aún no hay documentos</p>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">
        Sube tu primer PDF o .docx con el botón “Subir” para empezar a compartir
        y firmar.
      </p>
    </div>
  );
}
