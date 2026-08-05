"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import * as pdfjs from "pdfjs-dist";
import { Spinner } from "@/components/spinner";
import { cn } from "@/lib/utils";
import { X } from "lucide-react";

// El worker se sirve desde nuestro dominio (lo copia scripts/copy-pdf-worker.mjs).
pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

/**
 * Un campo de firma vive en el sistema de coordenadas del PDF: puntos, con el
 * origen abajo a la izquierda. Guardarlo así lo hace independiente del zoom y
 * del tamaño de pantalla, y coincide con lo que espera pdf-lib al estampar.
 */
export type SignField = {
  id: string;
  page: number; // 1-indexed
  x: number;
  y: number;
  w: number;
  h: number;
  assigned_email: string | null;
  signed?: boolean;
};

export type FieldBox = { x: number; y: number; w: number; h: number };

/** Tamaño por defecto de un campo nuevo, en puntos PDF. */
export const DEFAULT_FIELD = { w: 170, h: 55 };
const MIN_W = 70;
const MIN_H = 28;

/** Firma ya trazada que se está colocando, antes de confirmarla. */
export type PendingSignature = {
  src: string;
  page: number;
  box: FieldBox;
};

/** Id reservado para la firma en curso; no existe en la base de datos. */
const PENDING = "__pending__";

type PageInfo = { width: number; height: number };
type Drag =
  | { id: string; mode: "move" | "resize"; startX: number; startY: number; box: FieldBox; page: number }
  | null;

export function PdfViewer({
  url,
  fields,
  placing = false,
  onPlace,
  onRemove,
  onUpdate,
  pending,
  onPendingChange,
  onPagesReady,
  highlightEmail,
}: {
  url: string;
  fields: SignField[];
  placing?: boolean;
  onPlace?: (page: number, x: number, y: number) => void;
  onRemove?: (id: string) => void;
  /** Si se pasa, los campos sin firmar se pueden mover y redimensionar. */
  onUpdate?: (id: string, box: FieldBox) => void;
  /** Firma trazada que el usuario está colocando sobre el documento. */
  pending?: PendingSignature | null;
  onPendingChange?: (page: number, box: FieldBox) => void;
  /** Tamaño de cada página en puntos, para poder centrar cosas desde fuera. */
  onPagesReady?: (pages: { width: number; height: number }[]) => void;
  highlightEmail?: string | null;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRefs = useRef<(HTMLCanvasElement | null)[]>([]);
  const docRef = useRef<pdfjs.PDFDocumentProxy | null>(null);

  const [pages, setPages] = useState<PageInfo[]>([]);
  const [scale, setScale] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Mientras se arrastra se pinta desde aquí, para que responda al instante
  // sin esperar al guardado.
  const [drag, setDrag] = useState<Drag>(null);
  const [overrides, setOverrides] = useState<Record<string, FieldBox>>({});
  // Tras arrastrar, el navegador emite un `click` sobre donde se soltó. Si se
  // soltó fuera del recuadro, ese click cae en la página y crearía un campo
  // nuevo; para entonces el estado de arrastre ya se limpió, así que hace
  // falta esta marca para descartarlo.
  const swallowClick = useRef(false);
  // Vía ref para no re-cargar el PDF cada vez que el padre recrea la función.
  const onPagesReadyRef = useRef(onPagesReady);
  onPagesReadyRef.current = onPagesReady;

  // La firma en curso puede caer fuera de la pantalla (las páginas son altas):
  // sin esto el usuario traza su firma, pulsa Continuar y no ve nada.
  const pendingRef = useRef<HTMLDivElement>(null);
  const pendingPage = pending?.page ?? null;
  useEffect(() => {
    if (pendingPage === null) return;
    pendingRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [pendingPage]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const task = pdfjs.getDocument({ url });
    task.promise
      .then(async (pdf) => {
        if (cancelled) return;
        docRef.current = pdf;
        const infos: PageInfo[] = [];
        for (let n = 1; n <= pdf.numPages; n++) {
          const page = await pdf.getPage(n);
          const v = page.getViewport({ scale: 1 });
          infos.push({ width: v.width, height: v.height });
        }
        if (cancelled) return;
        setPages(infos);
        onPagesReadyRef.current?.(infos);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("pdf load", err);
        setError("No se pudo abrir el PDF.");
        setLoading(false);
      });

    return () => {
      cancelled = true;
      task.destroy().catch(() => {});
    };
  }, [url]);

  const recomputeScale = useCallback(() => {
    const el = containerRef.current;
    if (!el || pages.length === 0) return;
    const available = el.clientWidth - 8;
    setScale(Math.min(available / pages[0].width, 1.6));
  }, [pages]);

  useEffect(() => {
    recomputeScale();
    window.addEventListener("resize", recomputeScale);
    return () => window.removeEventListener("resize", recomputeScale);
  }, [recomputeScale]);

  useEffect(() => {
    const pdf = docRef.current;
    if (!pdf || pages.length === 0 || scale <= 0) return;

    let cancelled = false;
    const tasks: pdfjs.RenderTask[] = [];

    (async () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      for (let n = 1; n <= pages.length; n++) {
        if (cancelled) return;
        const canvas = canvasRefs.current[n - 1];
        if (!canvas) continue;

        const page = await pdf.getPage(n);
        const viewport = page.getViewport({ scale: scale * dpr });
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        canvas.style.width = `${viewport.width / dpr}px`;
        canvas.style.height = `${viewport.height / dpr}px`;

        const task = page.render({ canvas, viewport });
        tasks.push(task);
        try {
          await task.promise;
        } catch {
          // render cancelado por un cambio de escala: no es un error real
        }
      }
    })();

    return () => {
      cancelled = true;
      tasks.forEach((t) => t.cancel());
    };
  }, [pages, scale]);

  const boxOf = useCallback(
    (f: SignField): FieldBox =>
      overrides[f.id] ?? { x: f.x, y: f.y, w: f.w, h: f.h },
    [overrides]
  );

  const pendingBox = pending
    ? (overrides[PENDING] ?? pending.box)
    : { x: 0, y: 0, w: 0, h: 0 };

  function startDrag(
    e: React.PointerEvent,
    id: string,
    page: number,
    box: FieldBox,
    mode: "move" | "resize"
  ) {
    e.stopPropagation();
    e.preventDefault();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    setDrag({ id, mode, startX: e.clientX, startY: e.clientY, box, page });
  }

  function onDragMove(e: React.PointerEvent) {
    if (!drag) return;
    const info = pages[drag.page - 1];
    if (!info) return;

    // CSS → puntos PDF. El eje Y va al revés que en pantalla.
    const dx = (e.clientX - drag.startX) / scale;
    const dy = (e.clientY - drag.startY) / scale;
    const b = drag.box;
    let next: FieldBox;

    if (drag.mode === "move") {
      next = { ...b, x: b.x + dx, y: b.y - dy };
    } else {
      // El tirador está abajo a la derecha en pantalla: al bajarlo crece el
      // alto y el borde inferior (la y del PDF) desciende.
      const w = Math.max(MIN_W, b.w + dx);
      const h = Math.max(MIN_H, b.h + dy);
      next = { x: b.x, y: b.y + b.h - h, w, h };
    }

    // No dejar que el campo se salga de la página.
    next.w = Math.min(next.w, info.width);
    next.h = Math.min(next.h, info.height);
    next.x = Math.max(0, Math.min(next.x, info.width - next.w));
    next.y = Math.max(0, Math.min(next.y, info.height - next.h));

    setOverrides((o) => ({ ...o, [drag.id]: next }));
  }

  function endDrag() {
    if (!drag) return;
    const box = overrides[drag.id];
    if (box) {
      if (drag.id === PENDING) onPendingChange?.(drag.page, box);
      else onUpdate?.(drag.id, box);
    }
    swallowClick.current = true;
    setDrag(null);
  }

  function handlePageClick(
    e: React.MouseEvent<HTMLDivElement>,
    pageIndex: number
  ) {
    if (swallowClick.current) {
      swallowClick.current = false;
      return;
    }
    if (drag) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const cssX = e.clientX - rect.left;
    const cssY = e.clientY - rect.top;
    const info = pages[pageIndex];

    // Con una firma en curso, el clic la lleva ahí: así se puede saltar de
    // página sin tener que arrastrarla por todo el documento.
    if (pending && onPendingChange) {
      const b = pendingBox;
      const next = {
        w: b.w,
        h: b.h,
        x: clamp(cssX / scale - b.w / 2, 0, info.width - b.w),
        y: clamp(info.height - cssY / scale - b.h / 2, 0, info.height - b.h),
      };
      setOverrides((o) => ({ ...o, [PENDING]: next }));
      onPendingChange(pageIndex + 1, next);
      return;
    }

    if (!placing || !onPlace) return;
    onPlace(
      pageIndex + 1,
      clamp(cssX / scale - DEFAULT_FIELD.w / 2, 0, info.width - DEFAULT_FIELD.w),
      clamp(
        info.height - cssY / scale - DEFAULT_FIELD.h / 2,
        0,
        info.height - DEFAULT_FIELD.h
      )
    );
  }

  if (error) {
    return (
      <div className="flex h-full min-h-[50vh] items-center justify-center rounded-lg border border-dashed border-line-strong bg-surface text-sm text-muted">
        {error}
      </div>
    );
  }

  return (
    <div ref={containerRef} className="w-full">
      {loading && (
        <div className="flex min-h-[50vh] items-center justify-center gap-2 text-muted">
          <Spinner className="h-5 w-5 text-seal" />
          <span className="text-sm">Cargando documento…</span>
        </div>
      )}

      <div className="flex flex-col items-center gap-4">
        {pages.map((info, i) => (
          <div
            key={i}
            onClick={(e) => handlePageClick(e, i)}
            onPointerMove={onDragMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            className={cn(
              "relative shadow-card",
              (placing || pending) && "cursor-crosshair"
            )}
            style={{ width: info.width * scale, height: info.height * scale }}
          >
            <canvas
              ref={(el) => {
                canvasRefs.current[i] = el;
              }}
              className="block rounded-sm bg-white"
            />

            {fields
              // Un campo ya firmado no se dibuja: su rúbrica está estampada en
              // el propio PDF, y el recuadro la taparía.
              .filter((f) => f.page === i + 1 && !f.signed)
              .map((f) => (
                <Box
                  key={f.id}
                  label={f.assigned_email ?? "Sin asignar"}
                  box={boxOf(f)}
                  scale={scale}
                  pageHeight={info.height}
                  editable={!!onUpdate && !pending}
                  dragging={drag?.id === f.id}
                  onRemove={onRemove ? () => onRemove(f.id) : undefined}
                  onStart={(e, mode) =>
                    startDrag(e, f.id, f.page, boxOf(f), mode)
                  }
                  mine={
                    !!highlightEmail &&
                    f.assigned_email?.toLowerCase() ===
                      highlightEmail.toLowerCase()
                  }
                />
              ))}

            {/* Firma trazada que se está colocando. */}
            {pending && pending.page === i + 1 && (
              <Box
                innerRef={pendingRef}
                box={pendingBox}
                scale={scale}
                pageHeight={info.height}
                editable
                dragging={drag?.id === PENDING}
                onStart={(e, mode) =>
                  startDrag(e, PENDING, pending.page, pendingBox, mode)
                }
                mine
                image={pending.src}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

const clamp = (v: number, min: number, max: number) =>
  Math.max(min, Math.min(v, Math.max(min, max)));

function Box({
  label,
  image,
  innerRef,
  box,
  scale,
  pageHeight,
  editable,
  dragging,
  onRemove,
  onStart,
  mine,
}: {
  label?: string;
  /** Si se pasa, el recuadro muestra la rúbrica en vez del email. */
  image?: string;
  innerRef?: React.Ref<HTMLDivElement>;
  box: FieldBox;
  scale: number;
  pageHeight: number;
  editable: boolean;
  dragging: boolean;
  onRemove?: () => void;
  onStart: (e: React.PointerEvent, mode: "move" | "resize") => void;
  mine: boolean;
}) {
  // Puntos PDF (origen abajo) → CSS (origen arriba).
  const style = {
    left: box.x * scale,
    top: (pageHeight - box.y - box.h) * scale,
    width: box.w * scale,
    height: box.h * scale,
  };

  return (
    <div
      ref={innerRef}
      style={style}
      onPointerDown={(e) => editable && onStart(e, "move")}
      onClick={(e) => e.stopPropagation()}
      className={cn(
        "absolute flex touch-none select-none items-center justify-center rounded-sm border-2 border-dashed text-center",
        mine ? "border-seal" : "border-line-strong",
        image ? "bg-seal/5" : mine ? "bg-seal/10" : "bg-ink/5",
        editable && (dragging ? "cursor-grabbing" : "cursor-grab"),
        dragging && "ring-2 ring-seal/40"
      )}
    >
      {image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={image}
          alt="Tu firma"
          draggable={false}
          className="pointer-events-none h-full w-full object-contain p-1"
        />
      ) : (
        <span
          className={cn(
            "pointer-events-none truncate px-1.5 text-[10px] font-medium",
            mine ? "text-seal" : "text-muted"
          )}
        >
          {label}
        </span>
      )}

      {editable && (
        <>
          {/* Tirador de tamaño, abajo a la derecha. */}
          <span
            onPointerDown={(e) => onStart(e, "resize")}
            role="button"
            aria-label="Cambiar tamaño"
            className={cn(
              "absolute -bottom-1.5 -right-1.5 h-3.5 w-3.5 cursor-nwse-resize rounded-sm border-2 bg-surface",
              mine ? "border-seal" : "border-line-strong"
            )}
          />
          {onRemove && (
            <button
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onRemove();
              }}
              aria-label={`Quitar campo de ${label ?? "sin asignar"}`}
              className="absolute -right-2.5 -top-2.5 rounded-full border border-line bg-surface p-0.5 text-muted shadow-card transition-colors hover:text-danger"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </>
      )}
    </div>
  );
}
