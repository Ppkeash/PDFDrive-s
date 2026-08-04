"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { createFolder } from "@/app/drive/actions";
import { FolderPlus } from "lucide-react";
import { Spinner } from "@/components/spinner";

export function NewFolderButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function create() {
    const name = window.prompt("Nombre de la carpeta");
    if (!name) return;
    startTransition(async () => {
      await createFolder(name);
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
