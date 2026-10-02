"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { renameDocument, softDeleteDocument } from "@/app/drive/actions";
import { StatusChip } from "@/components/status-chip";
import { MenuItem, RowMenu } from "@/components/row-menu";
import { MoveDialog, type FolderOption } from "@/components/move-dialog";
import { NameDialog } from "@/components/name-dialog";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Download, FolderInput, Pencil, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DocStatus } from "@/types";

export function DocumentRow({
  id,
  name,
  status,
  storagePath,
  cuando,
  fechaCompleta,
  folderId,
  folders,
  ruta = null,
  seleccionado = false,
  onSeleccionar,
}: {
  id: string;
  name: string;
  status: DocStatus;
  storagePath: string;
  /** Texto corto de la fecha, ya formateado en el servidor. */
  cuando: string;
  /** Fecha y hora completas, para el `title`. */
  fechaCompleta: string;
  folderId: string | null;
  folders: FolderOption[];
  /** Carpeta donde vive. Se muestra al buscar, que es cuando no se sabe. */
  ruta?: string | null;
  seleccionado?: boolean;
  onSeleccionar?: (id: string, valor: boolean) => void;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [moveOpen, setMoveOpen] = useState(false);
  const [renombrando, setRenombrando] = useState(false);
  const [borrando, setBorrando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  async function download() {
    const { data } = await supabase.storage
      .from("originals")
      .createSignedUrl(storagePath, 60);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank");
  }

  function renombrar(nombre: string) {
    setError(null);
    startTransition(async () => {
      const res = await renameDocument(id, nombre);
      if (res.error) return setError(res.error);
      setRenombrando(false);
      router.refresh();
    });
  }

  function borrar() {
    startTransition(async () => {
      const res = await softDeleteDocument(id);
      if (res.error) return setError(res.error);
      setBorrando(false);
      router.refresh();
    });
  }

  return (
    <li
      className={cn(
        "group relative flex items-center gap-3 px-4 py-3.5 transition-colors sm:px-5",
        seleccionado ? "bg-seal-soft" : "hover:bg-surface-2",
        pending && "pointer-events-none opacity-50"
      )}
    >
      {onSeleccionar && (
        // z-10: la fila entera es un enlace con una capa invisible encima, y
        // sin esto la casilla quedaría debajo y no se podría marcar.
        <span className="relative z-10 shrink-0">
          <input
            type="checkbox"
            checked={seleccionado}
            onChange={(e) => onSeleccionar(id, e.target.checked)}
            aria-label={`Seleccionar ${name}`}
            className="h-4 w-4 cursor-pointer accent-seal"
          />
        </span>
      )}

      <PageMark />

      <Link href={`/doc/${id}`} className="min-w-0 flex-1 py-0.5">
        <p className="truncate text-sm font-medium">{name}</p>
        <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-muted">
          <span className="tnum shrink-0 font-mono" title={fechaCompleta}>
            {cuando}
          </span>
          {ruta && (
            <>
              <span aria-hidden>·</span>
              <span className="truncate">{ruta}</span>
            </>
          )}
        </p>
        <span className="absolute inset-0" aria-hidden />
      </Link>

      <StatusChip status={status} />

      <div className="relative z-10">
        <RowMenu label={`Acciones de ${name}`}>
          {(close) => (
            <>
              <MenuItem
                icon={<Download />}
                onClick={() => {
                  close();
                  download();
                }}
              >
                Descargar
              </MenuItem>
              <MenuItem
                icon={<FolderInput />}
                onClick={() => {
                  close();
                  setMoveOpen(true);
                }}
              >
                Mover a…
              </MenuItem>
              <MenuItem
                icon={<Pencil />}
                onClick={() => {
                  close();
                  setError(null);
                  setRenombrando(true);
                }}
              >
                Renombrar
              </MenuItem>
              <MenuItem
                icon={<Trash2 />}
                danger
                onClick={() => {
                  close();
                  setError(null);
                  setBorrando(true);
                }}
              >
                Enviar a la papelera
              </MenuItem>
            </>
          )}
        </RowMenu>
      </div>

      <MoveDialog
        open={moveOpen}
        documentIds={[id]}
        etiqueta={name}
        currentFolderId={folderId}
        folders={folders}
        onClose={() => setMoveOpen(false)}
      />

      <NameDialog
        open={renombrando}
        title="Renombrar documento"
        label="Nombre del documento"
        initial={name}
        confirmLabel="Guardar"
        busy={pending}
        error={error}
        onSubmit={renombrar}
        onCancel={() => !pending && setRenombrando(false)}
      />

      <ConfirmDialog
        open={borrando}
        title="¿Enviarlo a la papelera?"
        confirmLabel="Enviar a la papelera"
        tone="danger"
        busy={pending}
        onConfirm={borrar}
        onCancel={() => !pending && setBorrando(false)}
      >
        <p className="truncate font-medium text-ink">{name}</p>
        <p>
          Queda en la papelera y se puede restaurar. Las firmas que ya tenga no
          se tocan.
        </p>
        {error && (
          <p role="alert" className="text-danger">
            {error}
          </p>
        )}
      </ConfirmDialog>
    </li>
  );
}

/** Hoja de papel con esquina doblada — más específica que un icono genérico. */
function PageMark() {
  return (
    <svg
      viewBox="0 0 28 32"
      className="h-8 w-7 shrink-0 text-line-strong"
      aria-hidden="true"
    >
      <path
        d="M1 1h17l9 9v21H1z"
        fill="rgb(var(--surface))"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinejoin="round"
      />
      <path
        d="M18 1v9h9"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinejoin="round"
      />
      <path
        d="M6 17h14M6 21h14M6 25h9"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
        opacity="0.55"
      />
    </svg>
  );
}
