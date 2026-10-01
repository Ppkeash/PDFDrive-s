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
 * **El papel se pinta dentro del canvas, no con CSS.** Reportado por alguien
 * firmando: con el alto contraste del sistema el recuadro salía negro y la
 * firma no se veía al trazarla. La causa es que el fondo venía de CSS y la
 * tinta de píxeles de canvas: el alto contraste, el modo oscuro forzado del
 * navegador y las extensiones que oscurecen sitios reescriben los colores de
 * CSS pero no tocan lo dibujado en un canvas. Fondo invertido a negro, tinta
 * negra intacta, nada visible.
 *
 * Tiene que ser el MISMO canvas, no uno de fondo debajo: cualquier regla que
 * ponga fondo a todos los elementos se lo pone también al canvas de encima, y
 * ese fondo tapa lo que haya debajo. Comprobado en el navegador.
 *
 * Como el papel va en el lienzo visible, la exportación sale de un segundo
 * lienzo que vive fuera del DOM --ninguna regla de CSS lo alcanza-- donde se
 * replica cada trazo sin papel. De ahí sale el PNG transparente.
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
  /** Copia solo-tinta, fuera del DOM. Es la que se exporta. */
  const tintaRef = useRef<HTMLCanvasElement | null>(null);
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

  /** Los dos contextos: lo que se ve y lo que se exporta. */
  const contextos = useCallback((): CanvasRenderingContext2D[] => {
    const a = canvasRef.current?.getContext("2d");
    const b = tintaRef.current?.getContext("2d");
    return [a, b].filter(Boolean) as CanvasRenderingContext2D[];
  }, []);

  /** Papel, pauta y, mientras no haya tinta, la pista. Solo en el visible. */
  const pintarPapel = useCallback((conPista: boolean) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.width / dpr;
    const h = canvas.height / dpr;

    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

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

    // Repintar el papel borra el trazo del lienzo visible, así que hay que
    // dejar los ajustes de dibujo como estaban.
    ctx.strokeStyle = TINTA;
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
  }, []);

  // Preparar los lienzos cada vez que se abre.
  useEffect(() => {
    if (!open) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (!tintaRef.current) tintaRef.current = document.createElement("canvas");
    const tinta = tintaRef.current;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = canvas.getBoundingClientRect();
    for (const c of [canvas, tinta]) {
      c.width = rect.width * dpr;
      c.height = rect.height * dpr;
    }

    for (const ctx of [canvas.getContext("2d"), tinta.getContext("2d")]) {
      if (!ctx) continue;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.lineWidth = 2.2;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = TINTA;
    }

    pintarPapel(true);
    bounds.current = null;
    setHasInk(false);
  }, [open, pintarPapel]);

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

    // Quitar la pista antes del primer trazo: repintar después lo borraría.
    if (!hasInk) {
      pintarPapel(false);
      setHasInk(true);
    }

    // Un toque suelto también deja marca (un punto).
    for (const ctx of contextos()) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 1.1, 0, Math.PI * 2);
      ctx.fillStyle = TINTA;
      ctx.fill();
    }
  }

  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const prev = last.current;
    if (!prev) return;

    const p = pointFrom(e);
    const mid = { x: (prev.x + p.x) / 2, y: (prev.y + p.y) / 2 };
    const from = lastMid.current ?? prev;

    // Cada tramo arranca en el punto medio anterior y termina en el nuevo,
    // usando el punto real como control. Así el trazo queda continuo: partir
    // siempre del punto real dejaba sin pintar media distancia entre eventos
    // y la firma salía a rayas.
    for (const ctx of contextos()) {
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.quadraticCurveTo(prev.x, prev.y, mid.x, mid.y);
      ctx.stroke();
    }

    lastMid.current = mid;
    last.current = p;
    track(p);
  }

  function end() {
    // Cerrar el trazo hasta el último punto real, que si no queda cortado.
    const from = lastMid.current;
    const p = last.current;
    if (from && p) {
      for (const ctx of contextos()) {
        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
      }
    }
    drawing.current = false;
    last.current = null;
    lastMid.current = null;
  }

  function clear() {
    const tinta = tintaRef.current;
    const tctx = tinta?.getContext("2d");
    if (tinta && tctx) {
      tctx.save();
      tctx.setTransform(1, 0, 0, 1, 0, 0);
      tctx.clearRect(0, 0, tinta.width, tinta.height);
      tctx.restore();
    }

    pintarPapel(true);
    bounds.current = null;
    lastMid.current = null;
    last.current = null;
    setHasInk(false);
  }

  /**
   * Recorta al área con tinta y exporta PNG transparente, desde la copia sin
   * papel: exportar el lienzo visible metería un rectángulo blanco sobre el
   * documento al estamparlo.
   */
  function confirm() {
    const tinta = tintaRef.current;
    const b = bounds.current;
    if (!tinta || !b) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const pad = 8;
    const sx = Math.max(0, (b.minX - pad) * dpr);
    const sy = Math.max(0, (b.minY - pad) * dpr);
    const sw = Math.min(tinta.width - sx, (b.maxX - b.minX + pad * 2) * dpr);
    const sh = Math.min(tinta.height - sy, (b.maxY - b.minY + pad * 2) * dpr);

    const out = document.createElement("canvas");
    out.width = Math.max(1, Math.round(sw));
    out.height = Math.max(1, Math.round(sh));
    const octx = out.getContext("2d");
    if (!octx) return;
    octx.drawImage(tinta, sx, sy, sw, sh, 0, 0, out.width, out.height);

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
            className="rounded border border-line-strong"
            // Declarar el esquema de color ayuda con el modo oscuro forzado del
            // navegador; el papel de verdad lo pinta el canvas.
            style={{ colorScheme: "light" }}
          >
            <canvas
              ref={canvasRef}
              onPointerDown={start}
              onPointerMove={move}
              onPointerUp={end}
              onPointerLeave={end}
              className="block h-44 w-full touch-none rounded"
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
