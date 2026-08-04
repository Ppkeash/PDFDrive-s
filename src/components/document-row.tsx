"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { renameDocument, softDeleteDocument } from "@/app/drive/actions";
import { StatusChip } from "@/components/status-chip";
import { Download, MoreVertical, Pencil, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DocStatus } from "@/types";

export function DocumentRow({
  id,
  name,
  status,
  storagePath,
  createdAt,
}: {
  id: string;
  name: string;
  status: DocStatus;
  storagePath: string;
  createdAt: string;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [menuOpen, setMenuOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  async function download() {
    setMenuOpen(false);
    const { data } = await supabase.storage
      .from("originals")
      .createSignedUrl(storagePath, 60);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank");
  }

  function rename() {
    setMenuOpen(false);
    const next = window.prompt("Nuevo nombre", name);
    if (!next || next === name) return;
    startTransition(async () => {
      await renameDocument(id, next);
      router.refresh();
    });
  }

  function remove() {
    setMenuOpen(false);
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
        <button
          onClick={() => setMenuOpen((v) => !v)}
          className="rounded p-2 text-muted transition-colors hover:bg-surface hover:text-ink"
          aria-label={`Acciones de ${name}`}
          aria-expanded={menuOpen}
        >
          <MoreVertical className="h-4 w-4" />
        </button>

        {menuOpen && (
          <>
            <div
              className="fixed inset-0 z-10"
              onClick={() => setMenuOpen(false)}
            />
            <div className="absolute right-0 z-20 mt-1 w-44 overflow-hidden rounded-md border border-line bg-surface p-1 shadow-pop">
              <MenuItem icon={<Download />} onClick={download}>
                Descargar
              </MenuItem>
              <MenuItem icon={<Pencil />} onClick={rename}>
                Renombrar
              </MenuItem>
              <MenuItem icon={<Trash2 />} onClick={remove} danger>
                Eliminar
              </MenuItem>
            </div>
          </>
        )}
      </div>
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

function MenuItem({
  icon,
  children,
  onClick,
  danger,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2.5 rounded px-2.5 py-2 text-sm transition-colors hover:bg-surface-2 [&>svg]:h-4 [&>svg]:w-4",
        danger ? "text-danger" : "text-ink"
      )}
    >
      {icon}
      {children}
    </button>
  );
}
