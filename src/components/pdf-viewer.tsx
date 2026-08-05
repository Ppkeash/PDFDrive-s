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

/** Tamaño por defecto de un campo nuevo, en puntos PDF. */
export const DEFAULT_FIELD = { w: 170, h: 55 };

type PageInfo = { width: number; height: number };

export function PdfViewer({
  url,
  fields,
  placing = false,
  onPlace,
  onRemove,
  highlightEmail,
}: {
  url: string;
  fields: SignField[];
  placing?: boolean;
  onPlace?: (page: number, x: number, y: number) => void;
  onRemove?: (id: string) => void;
  highlightEmail?: string | null;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRefs = useRef<(HTMLCanvasElement | null)[]>([]);
  const docRef = useRef<pdfjs.PDFDocumentProxy | null>(null);

  const [pages, setPages] = useState<PageInfo[]>([]);
  const [scale, setScale] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Cargar el documento y quedarse con el tamaño de cada página en puntos.
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

  // Escala: ajustar al ancho disponible, sin pasar de 1.6 para no pixelar.
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

  // Pintar cada página cuando cambie la escala.
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

  function handleClick(e: React.MouseEvent<HTMLDivElement>, pageIndex: number) {
    if (!placing || !onPlace) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const cssX = e.clientX - rect.left;
    const cssY = e.clientY - rect.top;
    const info = pages[pageIndex];

    // CSS → puntos PDF, centrando el campo en el clic y volteando el eje Y.
    const x = cssX / scale - DEFAULT_FIELD.w / 2;
    const y = info.height - cssY / scale - DEFAULT_FIELD.h / 2;

    onPlace(
      pageIndex + 1,
      Math.max(0, Math.min(x, info.width - DEFAULT_FIELD.w)),
      Math.max(0, Math.min(y, info.height - DEFAULT_FIELD.h))
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
            onClick={(e) => handleClick(e, i)}
            className={cn(
              "relative shadow-card",
              placing && "cursor-crosshair"
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
              .filter((f) => f.page === i + 1)
              .map((f) => (
                <FieldBox
                  key={f.id}
                  field={f}
                  scale={scale}
                  pageHeight={info.height}
                  onRemove={onRemove}
                  mine={
                    !!highlightEmail &&
                    f.assigned_email?.toLowerCase() ===
                      highlightEmail.toLowerCase()
                  }
                />
              ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function FieldBox({
  field,
  scale,
  pageHeight,
  onRemove,
  mine,
}: {
  field: SignField;
  scale: number;
  pageHeight: number;
  onRemove?: (id: string) => void;
  mine: boolean;
}) {
  // Puntos PDF (origen abajo) → CSS (origen arriba).
  const style = {
    left: field.x * scale,
    top: (pageHeight - field.y - field.h) * scale,
    width: field.w * scale,
    height: field.h * scale,
  };

  return (
    <div
      style={style}
      className={cn(
        "absolute flex items-center justify-center rounded-sm border-2 border-dashed text-center",
        field.signed
          ? "border-ok/60 bg-ok/5"
          : mine
            ? "border-seal bg-seal/10"
            : "border-line-strong bg-ink/5"
      )}
    >
      <span
        className={cn(
          "pointer-events-none truncate px-1.5 text-[10px] font-medium",
          field.signed ? "text-ok" : mine ? "text-seal" : "text-muted"
        )}
      >
        {field.signed
          ? "Firmado"
          : (field.assigned_email ?? "Sin asignar")}
      </span>

      {onRemove && !field.signed && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRemove(field.id);
          }}
          aria-label={`Quitar campo de ${field.assigned_email ?? "sin asignar"}`}
          className="absolute -right-2.5 -top-2.5 rounded-full border border-line bg-surface p-0.5 text-muted shadow-card transition-colors hover:text-danger"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}
