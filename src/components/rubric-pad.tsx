"use client";

import { useEffect, useRef, useState } from "react";
import { Spinner } from "@/components/spinner";
import { Eraser, X } from "lucide-react";

/**
 * Pad para trazar la rúbrica a mano. Devuelve un PNG con fondo transparente,
 * recortado a la tinta, para que al estamparlo en el PDF no quede un rectángulo
 * blanco encima del documento.
 *
 * El trazo se suaviza con curvas cuadráticas entre puntos medios: dibujar con
 * segmentos rectos entre eventos de puntero deja la firma angulosa.
 */
export function RubricPad({
  open,
  onCancel,
  onConfirm,
  busy,
  title = "Dibuja tu firma",
}: {
  open: boolean;
  onCancel: () => void;
  onConfirm: (pngDataUrl: string) => void;
  busy?: boolean;
  title?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const bounds = useRef<{
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  } | null>(null);
  const [hasInk, setHasInk] = useState(false);

  // Preparar el lienzo cada vez que se abre.
  useEffect(() => {
    if (!open) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#141018";

    bounds.current = null;
    setHasInk(false);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  function pointFrom(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function track(p: { x: number; y: number }) {
    const b = bounds.current;
    bounds.current = b
      ? {
          minX: Math.min(b.minX, p.x),
          minY: Math.min(b.minY, p.y),
          maxX: Math.max(b.maxX, p.x),
          maxY: Math.max(b.maxY, p.y),
        }
      : { minX: p.x, minY: p.y, maxX: p.x, maxY: p.y };
  }

  function start(e: React.PointerEvent<HTMLCanvasElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    const p = pointFrom(e);
    last.current = p;
    track(p);

    // Un toque suelto también deja marca (un punto).
    const ctx = canvasRef.current?.getContext("2d");
    if (ctx) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 1.1, 0, Math.PI * 2);
      ctx.fillStyle = "#141018";
      ctx.fill();
    }
    setHasInk(true);
  }

  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const ctx = canvasRef.current?.getContext("2d");
    const prev = last.current;
    if (!ctx || !prev) return;

    const p = pointFrom(e);
    const mid = { x: (prev.x + p.x) / 2, y: (prev.y + p.y) / 2 };

    ctx.beginPath();
    ctx.moveTo(prev.x, prev.y);
    ctx.quadraticCurveTo(prev.x, prev.y, mid.x, mid.y);
    ctx.stroke();

    last.current = p;
    track(p);
  }

  function end() {
    drawing.current = false;
    last.current = null;
  }

  function clear() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
    bounds.current = null;
    setHasInk(false);
  }

  /** Recorta al área con tinta y exporta PNG transparente. */
  function confirm() {
    const canvas = canvasRef.current;
    const b = bounds.current;
    if (!canvas || !b) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const pad = 8;
    const sx = Math.max(0, (b.minX - pad) * dpr);
    const sy = Math.max(0, (b.minY - pad) * dpr);
    const sw = Math.min(canvas.width - sx, (b.maxX - b.minX + pad * 2) * dpr);
    const sh = Math.min(canvas.height - sy, (b.maxY - b.minY + pad * 2) * dpr);

    const out = document.createElement("canvas");
    out.width = Math.max(1, Math.round(sw));
    out.height = Math.max(1, Math.round(sh));
    const octx = out.getContext("2d");
    if (!octx) return;
    octx.drawImage(canvas, sx, sy, sw, sh, 0, 0, out.width, out.height);

    onConfirm(out.toDataURL("image/png"));
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4 backdrop-blur-[2px]"
      onClick={onCancel}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="rubric-title"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg overflow-hidden rounded-lg border border-line bg-surface shadow-pop"
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 id="rubric-title" className="font-display text-lg font-semibold">
            {title}
          </h2>
          <button
            onClick={onCancel}
            aria-label="Cerrar"
            className="rounded p-1 text-muted transition-colors hover:bg-surface-2 hover:text-ink"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5">
          <div className="relative rounded border border-line-strong bg-white">
            <canvas
              ref={canvasRef}
              onPointerDown={start}
              onPointerMove={move}
              onPointerUp={end}
              onPointerLeave={end}
              className="block h-44 w-full touch-none"
            />
            {/* Línea de pauta: indica dónde va la firma sin estorbar. */}
            <div className="pointer-events-none absolute inset-x-8 bottom-9 border-b border-dashed border-neutral-300" />
            {!hasInk && (
              <p className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-neutral-400">
                Traza aquí tu firma
              </p>
            )}
          </div>

          <div className="mt-4 flex items-center justify-between gap-3">
            <button
              onClick={clear}
              disabled={!hasInk || busy}
              className="inline-flex h-10 items-center gap-2 rounded border border-line-strong bg-surface px-3.5 text-sm font-medium transition-colors hover:bg-surface-2 disabled:opacity-50"
            >
              <Eraser className="h-4 w-4" /> Borrar
            </button>

            <button
              onClick={confirm}
              disabled={!hasInk || busy}
              className="inline-flex h-10 items-center gap-2 rounded bg-seal px-4 text-sm font-medium text-seal-ink transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {busy && <Spinner />}
              {busy ? "Firmando…" : "Firmar documento"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
