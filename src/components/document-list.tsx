"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { trashDocuments } from "@/app/drive/actions";
import { DocumentRow } from "@/components/document-row";
import { MoveDialog, type FolderOption } from "@/components/move-dialog";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Spinner } from "@/components/spinner";
import { Download, FolderInput, Trash2, X } from "lucide-react";
import type { DocStatus } from "@/types";

export type DocItem = {
  id: string;
  name: string;
  status: DocStatus;
  storagePath: string;
  cuando: string;
  fechaCompleta: string;
  folderId: string | null;
  /** Carpeta donde vive; solo se muestra cuando se está buscando. */
  ruta?: string | null;
};

export type GrupoDocs = {
  clave: string;
  /** Vacío cuando la lista va plana (buscando o filtrando). */
  titulo: string;
  items: DocItem[];
};

/**
 * La lista de documentos, con sus grupos de fecha y la selección múltiple.
 *
 * La selección vive aquí y no en la URL: es un estado de trabajo, de los que
 * se pierden al recargar sin que a nadie le importe. Los filtros sí van en la
 * URL, porque esos se comparten y se vuelven a visitar.
 */
export function DocumentList({
  grupos,
  folders,
  carpetaActual = null,
}: {
  grupos: GrupoDocs[];
  folders: FolderOption[];
  carpetaActual?: string | null;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [seleccion, setSeleccion] = useState<Set<string>>(new Set());
  const [moviendo, setMoviendo] = useState(false);
  const [borrando, setBorrando] = useState(false);
  const [descargando, setDescargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const items = useMemo(() => grupos.flatMap((g) => g.items), [grupos]);
  const elegidos = items.filter((i) => seleccion.has(i.id));
  const todos = items.length > 0 && elegidos.length === items.length;

  function alternar(id: string, valor: boolean) {
    setSeleccion((s) => {
      const siguiente = new Set(s);
      if (valor) siguiente.add(id);
      else siguiente.delete(id);
      return siguiente;
    });
  }

  function alternarTodos(valor: boolean) {
    setSeleccion(valor ? new Set(items.map((i) => i.id)) : new Set());
  }

  function limpiar() {
    setSeleccion(new Set());
  }

  function borrar() {
    setError(null);
    startTransition(async () => {
      const res = await trashDocuments([...seleccion]);
      if (res.error) return setError(res.error);
      setBorrando(false);
      limpiar();
      router.refresh();
    });
  }

  /**
   * Descarga uno por uno, con una pausa entre cada uno.
   *
   * `window.open` en bucle lo bloquea el navegador a partir del segundo, así
   * que se usan enlaces con `download`. Y como el archivo vive en otro
   * dominio, el atributo `download` por sí solo no basta: hace falta el
   * parámetro `download` de la URL firmada para que Storage devuelva la
   * cabecera que fuerza la descarga en vez de abrir el PDF.
   */
  async function descargar() {
    setDescargando(true);
    setError(null);
    try {
      const { data, error: errFirma } = await supabase.storage
        .from("originals")
        .createSignedUrls(
          elegidos.map((i) => i.storagePath),
          120
        );
      if (errFirma) throw errFirma;

      for (const [i, firmada] of (data ?? []).entries()) {
        if (!firmada.signedUrl) continue;
        const nombre = elegidos[i]?.name ?? "documento.pdf";
        const url = `${firmada.signedUrl}&download=${encodeURIComponent(nombre)}`;

        const a = document.createElement("a");
        a.href = url;
        a.download = nombre;
        document.body.appendChild(a);
        a.click();
        a.remove();
        await new Promise((r) => setTimeout(r, 350));
      }
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "No se pudieron descargar los archivos."
      );
    } finally {
      setDescargando(false);
    }
  }

  return (
    <>
      <div className="mt-6 overflow-hidden rounded-lg border border-line bg-surface">
        {/* Franja de cabecera: el contador y el "seleccionar todo" en el mismo
            sitio, que es donde se mira cuántos hay. */}
        <div className="flex items-center gap-3 border-b border-line bg-surface-2 px-4 py-2.5 sm:px-5">
          <input
            type="checkbox"
            checked={todos}
            onChange={(e) => alternarTodos(e.target.checked)}
            aria-label={todos ? "Quitar la selección" : "Seleccionar todos"}
            className="h-4 w-4 cursor-pointer accent-seal"
          />
          <p className="text-xs text-muted">
            {elegidos.length > 0
              ? `${elegidos.length} de ${items.length} seleccionados`
              : `${items.length} ${items.length === 1 ? "documento" : "documentos"}`}
          </p>
        </div>

        {grupos.map((grupo) => (
          <section key={grupo.clave}>
            {grupo.titulo && (
              <h3 className="sticky top-0 z-[1] border-b border-line bg-surface/95 px-4 py-2 text-micro uppercase text-muted backdrop-blur sm:px-5">
                {grupo.titulo}
              </h3>
            )}
            <ul className="divide-y divide-line">
              {grupo.items.map((d) => (
                <DocumentRow
                  key={d.id}
                  id={d.id}
                  name={d.name}
                  status={d.status}
                  storagePath={d.storagePath}
                  cuando={d.cuando}
                  fechaCompleta={d.fechaCompleta}
                  folderId={d.folderId}
                  folders={folders}
                  ruta={d.ruta}
                  seleccionado={seleccion.has(d.id)}
                  onSeleccionar={alternar}
                />
              ))}
            </ul>
          </section>
        ))}
      </div>

      {error && (
        <p
          role="alert"
          className="mt-4 rounded border-l-2 border-danger bg-surface-2 px-3 py-2 text-sm text-danger"
        >
          {error}
        </p>
      )}

      {/* Barra de acciones de la selección. Fija abajo y centrada: se usa
          después de marcar filas, con la vista donde quedó. */}
      {elegidos.length > 0 && (
        <div className="fixed inset-x-0 bottom-20 z-[55] flex justify-center px-4 md:bottom-6">
          <div className="flex max-w-full items-center gap-1.5 overflow-x-auto rounded-full border border-line bg-surface px-2 py-2 shadow-pop">
            <button
              onClick={limpiar}
              aria-label="Quitar la selección"
              className="rounded-full p-2 text-muted transition-colors hover:bg-surface-2 hover:text-ink"
            >
              <X className="h-4 w-4" />
            </button>
            <span className="shrink-0 px-1 text-sm font-medium tabular-nums">
              {elegidos.length}
            </span>

            <Accion
              icon={<FolderInput className="h-4 w-4" />}
              onClick={() => setMoviendo(true)}
            >
              Mover a…
            </Accion>
            <Accion
              icon={
                descargando ? <Spinner className="h-4 w-4" /> : <Download className="h-4 w-4" />
              }
              onClick={descargar}
              disabled={descargando}
            >
              Descargar
            </Accion>
            <Accion
              icon={<Trash2 className="h-4 w-4" />}
              onClick={() => setBorrando(true)}
              peligro
            >
              Papelera
            </Accion>
          </div>
        </div>
      )}

      <MoveDialog
        open={moviendo}
        documentIds={[...seleccion]}
        etiqueta={
          elegidos.length === 1
            ? elegidos[0].name
            : `${elegidos.length} documentos`
        }
        // Solo se bloquea el destino actual si todos vienen del mismo sitio.
        currentFolderId={
          elegidos.every((i) => i.folderId === (carpetaActual ?? null))
            ? (carpetaActual ?? null)
            : undefined
        }
        folders={folders}
        onClose={() => setMoviendo(false)}
        onDone={limpiar}
      />

      <ConfirmDialog
        open={borrando}
        title={
          elegidos.length === 1
            ? "¿Enviarlo a la papelera?"
            : `¿Enviar ${elegidos.length} documentos a la papelera?`
        }
        confirmLabel="Enviar a la papelera"
        tone="danger"
        busy={pending}
        onConfirm={borrar}
        onCancel={() => !pending && setBorrando(false)}
      >
        <p>Quedan en la papelera y se pueden restaurar.</p>
      </ConfirmDialog>
    </>
  );
}

function Accion({
  icon,
  children,
  onClick,
  disabled,
  peligro,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  peligro?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={
        "inline-flex h-9 shrink-0 items-center gap-2 rounded-full px-3 text-sm font-medium transition-colors hover:bg-surface-2 disabled:opacity-50 " +
        (peligro ? "text-danger" : "text-ink")
      }
    >
      {icon}
      {children}
    </button>
  );
}
