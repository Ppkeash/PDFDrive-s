"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteFolder, renameFolder } from "@/app/drive/actions";
import { MenuItem, RowMenu } from "@/components/row-menu";
import { NameDialog } from "@/components/name-dialog";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Folder, Pencil, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

export function FolderCard({
  id,
  name,
  documentos = 0,
  enFirma = 0,
  subcarpetas = 0,
  destinoAlBorrar = "Mis documentos",
}: {
  id: string;
  name: string;
  /** Documentos directamente dentro, sin contar los de las subcarpetas. */
  documentos?: number;
  enFirma?: number;
  subcarpetas?: number;
  /** Dónde queda el contenido si se borra la carpeta: su carpeta padre. */
  destinoAlBorrar?: string;
}) {
  const router = useRouter();
  const [renombrando, setRenombrando] = useState(false);
  const [borrando, setBorrando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function renombrar(nombre: string) {
    setError(null);
    startTransition(async () => {
      const res = await renameFolder(id, nombre);
      if (res.error) return setError(res.error);
      setRenombrando(false);
      router.refresh();
    });
  }

  function borrar() {
    startTransition(async () => {
      const res = await deleteFolder(id);
      if (res.error) return setError(res.error);
      setBorrando(false);
      router.refresh();
    });
  }

  const resumen = [
    documentos > 0 &&
      `${documentos} ${documentos === 1 ? "documento" : "documentos"}`,
    subcarpetas > 0 &&
      `${subcarpetas} ${subcarpetas === 1 ? "subcarpeta" : "subcarpetas"}`,
    enFirma > 0 && `${enFirma} en firma`,
  ]
    .filter(Boolean)
    .join(" · ");

  const vacia = documentos === 0 && subcarpetas === 0;

  return (
    <li
      className={cn(
        "group relative flex items-center gap-2.5 rounded border border-line bg-surface pl-3.5 pr-1 transition-colors hover:bg-surface-2",
        pending && "pointer-events-none opacity-50"
      )}
    >
      <Folder className="h-4 w-4 shrink-0 text-muted" aria-hidden />
      <Link href={`/drive?carpeta=${id}`} className="min-w-0 flex-1 py-2.5">
        <span className="block truncate text-sm">{name}</span>
        {/* Qué hay dentro, sin tener que entrar. */}
        <span className="block truncate text-xs text-muted">
          {resumen || "Vacía"}
        </span>
        <span className="absolute inset-0" aria-hidden />
      </Link>

      <div className="relative z-10 shrink-0">
        <RowMenu label={`Acciones de la carpeta ${name}`}>
          {(close) => (
            <>
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
                Borrar carpeta
              </MenuItem>
            </>
          )}
        </RowMenu>
      </div>

      <NameDialog
        open={renombrando}
        title="Renombrar carpeta"
        label="Nombre de la carpeta"
        initial={name}
        confirmLabel="Guardar"
        busy={pending}
        error={error}
        onSubmit={renombrar}
        onCancel={() => !pending && setRenombrando(false)}
      />

      <ConfirmDialog
        open={borrando}
        title={`¿Borrar la carpeta "${name}"?`}
        confirmLabel="Borrar carpeta"
        tone="danger"
        busy={pending}
        onConfirm={borrar}
        onCancel={() => !pending && setBorrando(false)}
      >
        {vacia ? (
          <p>Está vacía, así que no se pierde nada.</p>
        ) : (
          <p>
            Lo que tiene dentro no se borra: {resumen} pasan a{" "}
            <strong className="font-medium text-ink">{destinoAlBorrar}</strong>.
          </p>
        )}
        <p>La carpeta en sí no se puede recuperar.</p>
        {error && (
          <p role="alert" className="text-danger">
            {error}
          </p>
        )}
      </ConfirmDialog>
    </li>
  );
}
