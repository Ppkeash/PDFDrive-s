"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { createFolder } from "@/app/drive/actions";
import { FolderPlus } from "lucide-react";

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
      className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm disabled:opacity-60"
    >
      <FolderPlus className="h-4 w-4" /> Carpeta
    </button>
  );
}
