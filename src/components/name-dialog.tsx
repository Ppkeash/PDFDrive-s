"use client";

import { useEffect, useRef, useState } from "react";
import { Spinner } from "@/components/spinner";
import { X } from "lucide-react";

/**
 * Pedir un nombre: crear una carpeta, renombrar algo.
 *
 * Esto se hacía con `window.prompt`, y el prompt nativo tiene tres problemas
 * que importan aquí: se ve como una alerta del navegador en medio de una
 * aplicación cuidada, no puede mostrar el error que devuelve el servidor
 * --un nombre repetido quedaba en silencio-- y bloquea el hilo, así que con
 * lector de pantalla o con el alto contraste del sistema queda fuera de todo
 * lo que la aplicación controla.
 */
export function NameDialog({
  open,
  title,
  label = "Nombre",
  initial = "",
  confirmLabel,
  hint,
  busy = false,
  error = null,
  onSubmit,
  onCancel,
}: {
  open: boolean;
  title: string;
  label?: string;
  initial?: string;
  confirmLabel: string;
  hint?: string;
  busy?: boolean;
  error?: string | null;
  onSubmit: (nombre: string) => void;
  onCancel: () => void;
}) {
  const [valor, setValor] = useState(initial);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setValor(initial);
    // Al renombrar, el nombre entero queda seleccionado: lo normal es
    // reemplazarlo, no añadirle letras al final.
    const t = setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 10);
    return () => clearTimeout(t);
  }, [open, initial]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onCancel]);

  if (!open) return null;

  const limpio = valor.trim();

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-ink/40 p-4 backdrop-blur-[2px]">
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="name-dialog-title"
        onSubmit={(e) => {
          e.preventDefault();
          if (limpio) onSubmit(limpio);
        }}
        className="w-full max-w-md overflow-hidden rounded-lg border border-line bg-surface shadow-pop"
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2
            id="name-dialog-title"
            className="font-display text-lg font-semibold"
          >
            {title}
          </h2>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            aria-label="Cerrar"
            className="rounded p-1 text-muted transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-40"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-col gap-1.5 p-5">
          <label
            htmlFor="name-dialog-input"
            className="text-micro uppercase text-muted"
          >
            {label}
          </label>
          <input
            id="name-dialog-input"
            ref={inputRef}
            value={valor}
            onChange={(e) => setValor(e.target.value)}
            maxLength={120}
            autoComplete="off"
            disabled={busy}
            className="h-11 rounded border border-line-strong bg-surface px-3 text-sm outline-none transition-colors focus:border-seal disabled:opacity-60"
          />
          {hint && <p className="text-xs text-muted">{hint}</p>}

          {error && (
            <p
              role="alert"
              className="mt-2 rounded border-l-2 border-danger bg-surface-2 px-3 py-2 text-sm text-danger"
            >
              {error}
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-line bg-surface-2 px-5 py-3.5">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="inline-flex h-10 items-center rounded border border-line-strong bg-surface px-4 text-sm font-medium transition-colors hover:bg-surface-2 disabled:opacity-60"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={busy || !limpio}
            className="inline-flex h-10 items-center gap-2 rounded bg-seal px-4 text-sm font-medium text-seal-ink transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {busy && <Spinner />}
            {busy ? "Un momento…" : confirmLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
