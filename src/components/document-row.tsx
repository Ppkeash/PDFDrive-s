"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { renameDocument, softDeleteDocument } from "@/app/drive/actions";
import {
  Download,
  FileText,
  MoreVertical,
  Pencil,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { DocStatus } from "@/types";

const STATUS_LABEL: Record<DocStatus, string> = {
  borrador: "Borrador",
  en_firma: "En firma",
  firmado: "Firmado",
  archivado: "Archivado",
};

const STATUS_COLOR: Record<DocStatus, string> = {
  borrador: "bg-muted text-muted-foreground",
  en_firma: "bg-amber-100 text-amber-700",
  firmado: "bg-green-100 text-green-700",
  archivado: "bg-muted text-muted-foreground",
};

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
        "flex items-center gap-3 p-4 transition-opacity",
        pending && "opacity-50"
      )}
    >
      <FileText className="h-5 w-5 shrink-0 text-muted-foreground" />
      <Link href={`/doc/${id}`} className="min-w-0 flex-1">
        <p className="truncate font-medium">{name}</p>
        <p className="text-xs text-muted-foreground">
          {new Date(createdAt).toLocaleDateString("es")}
        </p>
      </Link>

      <span
        className={cn(
          "rounded-full px-2 py-0.5 text-xs font-medium",
          STATUS_COLOR[status]
        )}
      >
        {STATUS_LABEL[status]}
      </span>

      <div className="relative">
        <button
          onClick={() => setMenuOpen((v) => !v)}
          className="rounded-lg p-2 text-muted-foreground hover:bg-muted"
          aria-label="Acciones"
        >
          <MoreVertical className="h-4 w-4" />
        </button>
        {menuOpen && (
          <>
            <div
              className="fixed inset-0 z-10"
              onClick={() => setMenuOpen(false)}
            />
            <div className="absolute right-0 z-20 mt-1 w-44 rounded-lg border bg-background p-1 shadow-lg">
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
        "flex w-full items-center gap-2 rounded px-2 py-2 text-sm hover:bg-muted [&>svg]:h-4 [&>svg]:w-4",
        danger && "text-red-600"
      )}
    >
      {icon}
      {children}
    </button>
  );
}
