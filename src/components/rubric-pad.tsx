"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Spinner } from "@/components/spinner";
import { Eraser, X } from "lucide-react";

/**
 * Pad para trazar la rúbrica a mano. Devuelve un PNG con fondo transparente,
 * recortado a la tinta, para que al estamparlo en el PDF no quede un rectángulo
 * blanco encima del documento.
 *
 * El trazo se suaviza con curvas cuadráticas entre puntos medios: dibujar con
 * segmentos rectos entre eventos de puntero deja la firma angulosa.
 *
 * **El papel se pinta dentro de un canvas, no con CSS.** Reportado por alguien
 * firmando: con el alto contraste de Windows el recuadro salía negro y la firma
 * no se veía al trazarla. La causa es que el fondo venía de CSS y la tinta de
 * píxeles de canvas: el alto contraste, el modo oscuro forzado del navegador y
 * las extensiones que oscurecen sitios reescriben los colores de CSS pero no
 * tocan lo dibujado en un canvas. Resultado: fondo invertido a negro, tinta
 * negra intacta, nada visible.
 *
 * Con el papel y la pauta pintados en un canvas de fondo, los dos corren la
 * misma suerte: si algo invierte la página, se invierten ambos y el contraste
 * se conserva; si no la invierte, se ven como se diseñaron.
 */
const TINTA = "#141018";
const PAPEL = "#ffffff";
const PAUTA = "#d4d4d4";
const PISTA = "#a3a3a3";

export function RubricPad({
  open,
  onCancel,
  onConfirm,
  busy,
  title = "Dibuja tu firma",
  confirmLabel = "Firmar documento",
  busyLabel = "Firmando…",
}: {
  open: boolean;
  onCancel: () => void;
  onConfirm: (pngDataUrl: string) => void;
  busy?: boolean;
  title?: string;
  confirmLabel?: string;
  busyLabel?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fondoRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const lastMid = useRef<{ x: number; y: number } | null>(null);
  const bounds = useRef<{
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  } | null>(null);
  const [hasInk, setHasInk] = useState(false);

  /** Papel, pauta y, mientras no haya tinta, la pista de qué hacer. */
  const pintarFondo = useCallback((conPista: boolean) => {
    const fondo = fondoRef.current;
    const ctx = fondo?.getContext("2d");
    if (!fondo || !ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = fondo.width / dpr;
    const h = fondo.height / dpr;

    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    ctx.fillStyle = PAPEL;
    ctx.fillRect(0, 0, w, h);

    // Pauta: dice dónde va la firma sin estorbar el trazo.
    ctx.strokeStyle = PAUTA;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(32, h - 36);
    ctx.lineTo(w - 32, h - 36);
    ctx.stroke();
    ctx.setLineDash([]);

    if (conPista) {
      ctx.fillStyle = PISTA;
      ctx.font =
        '13px var(--font-sans), system-ui, -apple-system, "Segoe UI", sans-serif';
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("Traza aquí tu firma", w / 2, h / 2);
    }

    ctx.restore();
  }, []);

  // Preparar los dos lienzos cada vez que se abre.
  useEffect(() => {
    if (!open) return;
    const canvas = canvasRef.current;
    const fondo = fondoRef.current;
    if (!canvas || !fondo) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = canvas.getBoundingClientRect();
    for (const c of [canvas, fondo]) {
      c.width = rect.width * dpr;
      c.height = rect.height * dpr;
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = TINTA;

    pintarFondo(true);
    bounds.current = null;
    setHasInk(false);
  }, [open, pintarFondo]);

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
    lastMid.current = p;
    track(p);

    // Un toque suelto también deja marca (un punto).
    const ctx = canvasRef.current?.getContext("2d");
    if (ctx) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 1.1, 0, Math.PI * 2);
      ctx.fillStyle = TINTA;
      ctx.fill();
    }

    if (!hasInk) {
      // La pista estorba en cuanto hay trazo encima.
      pintarFondo(false);
      setHasInk(true);
    }
  }

  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const ctx = canvasRef.current?.getContext("2d");
    const prev = last.current;
    if (!ctx || !prev) return;

    const p = pointFrom(e);
    const mid = { x: (prev.x + p.x) / 2, y: (prev.y + p.y) / 2 };
    const from = lastMid.current ?? prev;

    // Cada tramo arranca en el punto medio anterior y termina en el nuevo,
    // usando el punto real como control. Así el trazo queda continuo: partir
    // siempre del punto real dejaba sin pintar media distancia entre eventos
    // y la firma salía a rayas.
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.quadraticCurveTo(prev.x, prev.y, mid.x, mid.y);
    ctx.stroke();

    lastMid.current = mid;
    last.current = p;
    track(p);
  }

  function end() {
    // Cerrar el trazo hasta el último punto real, que si no queda cortado.
    const ctx = canvasRef.current?.getContext("2d");
    const from = lastMid.current;
    const p = last.current;
    if (ctx && from && p) {
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
    }
    drawing.current = false;
    last.current = null;
    lastMid.current = null;
  }

  function clear() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
    pintarFondo(true);
    bounds.current = null;
    lastMid.current = null;
    last.current = null;
    setHasInk(false);
  }

  /**
   * Recorta al área con tinta y exporta PNG transparente.
   *
   * Se exporta el lienzo del trazo, nunca el del papel: un PNG con fondo
   * blanco taparía el texto del documento al estamparlo.
   */
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
          <div
            className="relative rounded border border-line-strong bg-white"
            // `bg-white` queda como respaldo para el instante antes de pintar;
            // el papel de verdad lo pone el canvas de fondo. Declarar el
            // esquema de color ayuda además con el modo oscuro forzado del
            // navegador, que de otro modo reinvierte este recuadro.
            style={{ colorScheme: "light" }}
          >
            {/* Papel y pauta. Va en canvas y no en CSS para que no lo toquen
                el alto contraste ni las extensiones que oscurecen sitios. */}
            <canvas
              ref={fondoRef}
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 block h-44 w-full rounded"
            />
            <canvas
              ref={canvasRef}
              onPointerDown={start}
              onPointerMove={move}
              onPointerUp={end}
              onPointerLeave={end}
              className="relative block h-44 w-full touch-none"
              aria-label="Área para trazar la firma"
            />
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
              {busy ? busyLabel : confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
