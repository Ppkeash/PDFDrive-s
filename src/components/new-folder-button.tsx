"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createFolder } from "@/app/drive/actions";
import { NameDialog } from "@/components/name-dialog";
import { FolderPlus } from "lucide-react";
import { Spinner } from "@/components/spinner";

export function NewFolderButton({
  parentId = null,
}: {
  /** Crea la carpeta dentro de la que se está viendo, no siempre en la raíz. */
  parentId?: string | null;
}) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function crear(nombre: string) {
    setError(null);
    startTransition(async () => {
      const res = await createFolder(nombre, parentId);
      // El error se descartaba en silencio: un nombre repetido no decía nada
      // y parecía que el botón no hubiera hecho nada.
      if (res.error) return setError(res.error);

      setAbierto(false);
      // Entrar sola. Una carpeta se crea para meter algo dentro; quedarse
      // afuera obliga a buscarla y abrirla a mano, siempre.
      if (res.id) router.push(`/drive?carpeta=${res.id}`);
      router.refresh();
    });
  }

  return (
    <>
      <button
        onClick={() => {
          setError(null);
          setAbierto(true);
        }}
        disabled={pending}
        className="inline-flex h-10 items-center gap-2 rounded border border-line-strong bg-surface px-3.5 text-sm font-medium transition-colors hover:bg-surface-2 disabled:opacity-60"
      >
        {pending ? <Spinner /> : <FolderPlus className="h-4 w-4" />} Carpeta
      </button>

      <NameDialog
        open={abierto}
        title="Nueva carpeta"
        label="Nombre de la carpeta"
        confirmLabel="Crear y abrir"
        hint="Se abrirá al crearla, para que puedas subir los documentos ahí mismo."
        busy={pending}
        error={error}
        onSubmit={crear}
        onCancel={() => !pending && setAbierto(false)}
      />
    </>
  );
}
