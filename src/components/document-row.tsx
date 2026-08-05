"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { renameDocument, softDeleteDocument } from "@/app/drive/actions";
import { StatusChip } from "@/components/status-chip";
import { MenuItem, RowMenu } from "@/components/row-menu";
import { MoveDialog, type FolderOption } from "@/components/move-dialog";
import { Download, FolderInput, Pencil, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DocStatus } from "@/types";

export function DocumentRow({
  id,
  name,
  status,
  storagePath,
  createdAt,
  folderId,
  folders,
}: {
  id: string;
  name: string;
  status: DocStatus;
  storagePath: string;
  createdAt: string;
  folderId: string | null;
  folders: FolderOption[];
}) {
  const router = useRouter();
  const supabase = createClient();
  const [moveOpen, setMoveOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  async function download() {
    const { data } = await supabase.storage
      .from("originals")
      .createSignedUrl(storagePath, 60);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank");
  }

  function rename() {
    const next = window.prompt("Nuevo nombre", name);
    if (!next || next === name) return;
    startTransition(async () => {
      await renameDocument(id, next);
      router.refresh();
    });
  }

  function remove() {
    if (!window.confirm(`¿Mover "${name}" a la papelera?`)) return;
    startTransition(async () => {
      await softDeleteDocument(id);
      router.refresh();
    });
  }

  return (
    <li
      className={cn(
        "group relative flex items-center gap-4 px-5 py-3.5 transition-colors hover:bg-surface-2",
        pending && "pointer-events-none opacity-50"
      )}
    >
      <PageMark />

      <Link href={`/doc/${id}`} className="min-w-0 flex-1 py-0.5">
        <p className="truncate text-sm font-medium">{name}</p>
        <p className="tnum mt-0.5 font-mono text-xs text-muted">
          {new Date(createdAt).toLocaleDateString("es", {
            day: "2-digit",
            month: "short",
            year: "numeric",
          })}
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
                Eliminar
              </MenuItem>
            </>
          )}
        </RowMenu>
      </div>

      <MoveDialog
        open={moveOpen}
        documentId={id}
        documentName={name}
        currentFolderId={folderId}
        folders={folders}
        onClose={() => setMoveOpen(false)}
      />
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
