"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { createFolder } from "@/app/drive/actions";
import { FolderPlus } from "lucide-react";
import { Spinner } from "@/components/spinner";

export function NewFolderButton({
  parentId = null,
}: {
  /** Crea la carpeta dentro de la que se está viendo, no siempre en la raíz. */
  parentId?: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function create() {
    const name = window.prompt("Nombre de la carpeta");
    if (!name) return;
    startTransition(async () => {
      await createFolder(name, parentId);
      router.refresh();
    });
  }

  return (
    <button
      onClick={create}
      disabled={pending}
      className="inline-flex h-10 items-center gap-2 rounded border border-line-strong bg-surface px-3.5 text-sm font-medium transition-colors hover:bg-surface-2 disabled:opacity-60"
    >
      {pending ? <Spinner /> : <FolderPlus className="h-4 w-4" />} Carpeta
    </button>
  );
}
