"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { moveDocument } from "@/app/drive/actions";
import { Spinner } from "@/components/spinner";
import { Folder, FolderOpen, X } from "lucide-react";
import { cn } from "@/lib/utils";

export type FolderOption = { id: string; name: string };

export function MoveDialog({
  open,
  documentId,
  documentName,
  currentFolderId,
  folders,
  onClose,
}: {
  open: boolean;
  documentId: string;
  documentName: string;
  currentFolderId: string | null;
  folders: FolderOption[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [target, setTarget] = useState<string | null>(currentFolderId);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (open) setTarget(currentFolderId);
  }, [open, currentFolderId]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await moveDocument(documentId, target);
      if (res.error) return setError(res.error);
      onClose();
      router.refresh();
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="move-title"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md overflow-hidden rounded-lg border border-line bg-surface shadow-pop"
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 id="move-title" className="font-display text-lg font-semibold">
            Mover documento
          </h2>
          <button
            onClick={onClose}
            aria-label="Cerrar"
            className="rounded p-1 text-muted transition-colors hover:bg-surface-2 hover:text-ink"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5">
          <p className="mb-4 truncate text-sm text-muted">{documentName}</p>

          <div className="flex max-h-64 flex-col gap-1 overflow-y-auto">
            <Option
              icon={<FolderOpen className="h-4 w-4" />}
              label="Mis documentos"
              hint="Fuera de cualquier carpeta"
              selected={target === null}
              onSelect={() => setTarget(null)}
            />
            {folders.map((f) => (
              <Option
                key={f.id}
                icon={<Folder className="h-4 w-4" />}
                label={f.name}
                selected={target === f.id}
                onSelect={() => setTarget(f.id)}
              />
            ))}
          </div>

          {folders.length === 0 && (
            <p className="mt-3 text-xs text-muted">
              Todavía no tienes carpetas. Créalas con el botón “Carpeta”.
            </p>
          )}

          {error && (
            <p
              role="alert"
              className="mt-4 rounded border-l-2 border-danger bg-surface-2 px-3 py-2 text-sm text-danger"
            >
              {error}
            </p>
          )}

          <button
            onClick={submit}
            disabled={pending || target === currentFolderId}
            className="mt-5 inline-flex h-11 w-full items-center justify-center gap-2 rounded bg-seal px-4 text-sm font-medium text-seal-ink transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {pending && <Spinner />}
            {pending ? "Moviendo…" : "Mover aquí"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Option({
  icon,
  label,
  hint,
  selected,
  onSelect,
}: {
  icon: React.ReactNode;
  label: string;
  hint?: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      className={cn(
        "flex items-center gap-3 rounded border px-3 py-2.5 text-left transition-colors",
        selected
          ? "border-seal bg-seal-soft text-seal"
          : "border-line hover:bg-surface-2"
      )}
    >
      <span className="shrink-0">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{label}</span>
        {hint && <span className="block text-xs text-muted">{hint}</span>}
      </span>
    </button>
  );
}
