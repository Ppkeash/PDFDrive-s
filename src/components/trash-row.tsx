"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteDocumentForever, restoreDocument } from "@/app/drive/actions";
import { StatusChip } from "@/components/status-chip";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Spinner } from "@/components/spinner";
import { RotateCcw, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DocStatus } from "@/types";

export function TrashRow({
  id,
  name,
  status,
  cuando,
  fechaCompleta,
  ruta,
  diasParaPurga,
}: {
  id: string;
  name: string;
  status: DocStatus;
  /** Cuándo se envió a la papelera. */
  cuando: string;
  fechaCompleta: string;
  /** Dónde volverá al restaurarlo. */
  ruta: string;
  /** Días que le quedan antes de que la purga automática se lo lleve. */
  diasParaPurga: number;
}) {
  const router = useRouter();
  const [borrando, setBorrando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function restaurar() {
    setError(null);
    startTransition(async () => {
      const res = await restoreDocument(id);
      if (res.error) return setError(res.error);
      // Si la carpeta en la que estaba se borró mientras el documento estaba
      // aquí, reaparece en la raíz. Decirlo evita que se busque donde ya no
      // está.
      setAviso(
        res.folderId ? null : "Volvió a Mis documentos: su carpeta ya no existe."
      );
      router.refresh();
    });
  }

  function borrarDefinitivamente() {
    setError(null);
    startTransition(async () => {
      const res = await deleteDocumentForever(id);
      if (res.error) return setError(res.error);
      setBorrando(false);
      router.refresh();
    });
  }

  return (
    <li
      className={cn(
        "flex flex-wrap items-center gap-3 px-4 py-3.5 sm:px-5",
        pending && "pointer-events-none opacity-50"
      )}
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{name}</span>
        <span className="mt-0.5 block truncate text-xs text-muted">
          <span className="tnum font-mono" title={fechaCompleta}>
            {cuando}
          </span>
          {" · volverá a "}
          {ruta}
          {diasParaPurga <= 7 && (
            <span className="text-wait">
              {" · "}
              {diasParaPurga <= 0
                ? "se borra hoy"
                : `quedan ${diasParaPurga} ${diasParaPurga === 1 ? "día" : "días"}`}
            </span>
          )}
        </span>
        {aviso && <span className="mt-1 block text-xs text-wait">{aviso}</span>}
        {error && (
          <span role="alert" className="mt-1 block text-xs text-danger">
            {error}
          </span>
        )}
      </span>

      <StatusChip status={status} />

      <div className="flex shrink-0 items-center gap-1.5">
        <button
          onClick={restaurar}
          disabled={pending}
          className="inline-flex h-9 items-center gap-2 rounded border border-line-strong bg-surface px-3 text-sm font-medium transition-colors hover:bg-surface-2 disabled:opacity-60"
        >
          {pending ? <Spinner /> : <RotateCcw className="h-4 w-4" />} Restaurar
        </button>
        <button
          onClick={() => setBorrando(true)}
          disabled={pending}
          aria-label={`Eliminar definitivamente ${name}`}
          className="rounded p-2 text-muted transition-colors hover:bg-surface-2 hover:text-danger disabled:opacity-60"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      <ConfirmDialog
        open={borrando}
        title="¿Eliminarlo definitivamente?"
        confirmLabel="Eliminar definitivamente"
        tone="danger"
        busy={pending}
        onConfirm={borrarDefinitivamente}
        onCancel={() => !pending && setBorrando(false)}
      >
        <p className="truncate font-medium text-ink">{name}</p>
        <p>
          Se borra el archivo y su rastro en FirmaDrive. Las firmas que tuviera
          se van con él y <strong className="font-medium text-ink">esto no
          se puede deshacer</strong>.
        </p>
      </ConfirmDialog>
    </li>
  );
}
