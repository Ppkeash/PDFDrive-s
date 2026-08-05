"use client";

import Link from "next/link";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteFolder, renameFolder } from "@/app/drive/actions";
import { MenuItem, RowMenu } from "@/components/row-menu";
import { Folder, Pencil, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

export function FolderCard({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function rename() {
    const next = window.prompt("Nuevo nombre de la carpeta", name);
    if (!next || next === name) return;
    startTransition(async () => {
      await renameFolder(id, next);
      router.refresh();
    });
  }

  function remove() {
    if (
      !window.confirm(
        `¿Borrar la carpeta "${name}"?\n\nLos documentos que contenga no se borran: vuelven a Mis documentos.`
      )
    )
      return;
    startTransition(async () => {
      await deleteFolder(id);
      router.refresh();
    });
  }

  return (
    <li
      className={cn(
        "group relative flex items-center gap-2.5 rounded border border-line bg-surface pl-3.5 pr-1 transition-colors hover:bg-surface-2",
        pending && "pointer-events-none opacity-50"
      )}
    >
      <Folder className="h-4 w-4 shrink-0 text-muted" aria-hidden />
      <Link
        href={`/drive?carpeta=${id}`}
        className="min-w-0 flex-1 truncate py-3 text-sm"
      >
        {name}
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
                  rename();
                }}
              >
                Renombrar
              </MenuItem>
              <MenuItem
                icon={<Trash2 />}
                danger
                onClick={() => {
                  close();
                  remove();
                }}
              >
                Borrar carpeta
              </MenuItem>
            </>
          )}
        </RowMenu>
      </div>
    </li>
  );
}
