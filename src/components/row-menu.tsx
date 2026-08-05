"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MoreVertical } from "lucide-react";
import { cn } from "@/lib/utils";

const MENU_W = 200;

/**
 * Menú de acciones de una fila.
 *
 * Se dibuja en un portal con posición fija en vez de dentro de la fila: el
 * listado recorta su contenido (overflow-hidden por las esquinas redondeadas)
 * y el menú de las últimas filas quedaba cortado. Además se voltea hacia
 * arriba cuando no cabe abajo.
 */
export function RowMenu({
  label,
  children,
}: {
  label: string;
  children: (close: () => void) => React.ReactNode;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const close = () => setPos(null);

  function toggle() {
    if (pos) return close();
    const r = buttonRef.current?.getBoundingClientRect();
    if (!r) return;

    // Alinear a la derecha del botón, y abrir hacia arriba si abajo no cabe.
    const estimatedH = 160;
    const openUp = r.bottom + estimatedH > window.innerHeight;
    setPos({
      top: openUp ? r.top - estimatedH - 4 : r.bottom + 4,
      left: Math.max(8, r.right - MENU_W),
    });
  }

  useEffect(() => {
    if (!pos) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    // Al desplazar o redimensionar, la posición fija deja de ser válida.
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [pos]);

  return (
    <>
      <button
        ref={buttonRef}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          toggle();
        }}
        className="rounded p-2 text-muted transition-colors hover:bg-surface hover:text-ink"
        aria-label={label}
        aria-expanded={!!pos}
      >
        <MoreVertical className="h-4 w-4" />
      </button>

      {pos &&
        createPortal(
          <>
            <div className="fixed inset-0 z-40" onClick={close} />
            <div
              role="menu"
              style={{ top: pos.top, left: pos.left, width: MENU_W }}
              className="fixed z-50 overflow-hidden rounded-md border border-line bg-surface p-1 shadow-pop"
            >
              {children(close)}
            </div>
          </>,
          document.body
        )}
    </>
  );
}

export function MenuItem({
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
      role="menuitem"
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
