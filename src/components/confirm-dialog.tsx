"use client";

import { useEffect } from "react";
import { Spinner } from "@/components/spinner";
import { cn } from "@/lib/utils";
import { AlertTriangle } from "lucide-react";

/**
 * Confirmación para lo que no tiene vuelta atrás. Deliberadamente no se cierra
 * al pulsar fuera: firmar y sellar son actos definitivos, y un clic despistado
 * no debería decidirlos.
 */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  busy = false,
  tone = "seal",
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  children: React.ReactNode;
  confirmLabel: string;
  busy?: boolean;
  tone?: "seal" | "danger";
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onCancel]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-ink/40 p-4 backdrop-blur-[2px]">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        className="w-full max-w-md overflow-hidden rounded-lg border border-line bg-surface shadow-pop"
      >
        <div className="flex gap-3.5 p-5">
          <span
            className={cn(
              "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
              tone === "danger" ? "bg-danger/10" : "bg-seal-soft"
            )}
            aria-hidden
          >
            <AlertTriangle
              className={cn(
                "h-4 w-4",
                tone === "danger" ? "text-danger" : "text-seal"
              )}
            />
          </span>
          <div className="min-w-0">
            <h2 id="confirm-title" className="font-display text-lg font-semibold">
              {title}
            </h2>
            <div className="mt-2 flex flex-col gap-2 text-sm text-muted">
              {children}
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-line bg-surface-2 px-5 py-3.5">
          <button
            onClick={onCancel}
            disabled={busy}
            className="inline-flex h-10 items-center rounded border border-line-strong bg-surface px-4 text-sm font-medium transition-colors hover:bg-surface-2 disabled:opacity-60"
          >
            Cancelar
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            className={cn(
              "inline-flex h-10 items-center gap-2 rounded px-4 text-sm font-medium transition-opacity hover:opacity-90 disabled:opacity-60",
              tone === "danger"
                ? "bg-danger text-white"
                : "bg-seal text-seal-ink"
            )}
          >
            {busy && <Spinner />}
            {busy ? "Un momento…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
