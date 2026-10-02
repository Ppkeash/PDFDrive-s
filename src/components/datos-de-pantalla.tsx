"use client";

import { useEffect, useRef, useState } from "react";
import { pintarFirmaReducida } from "@/components/pdf-viewer";
import { Check, Copy, HelpCircle, X } from "lucide-react";

/**
 * "A mí se ve bien y a ella no."
 *
 * Esa frase se repitió tres veces seguidas con la firma pequeña, y cada vez
 * hubo que adivinar qué tenía distinto el otro equipo. Esto deja de adivinar:
 * muestra en pantalla lo que hace falta saber, y trae una prueba A/B que
 * separa las dos causas posibles de que una firma reducida no se vea.
 *
 *   A — la rúbrica reducida por el navegador, como se hacía antes.
 *   B — la misma rúbrica reducida por nosotros, como se hace ahora.
 *
 * Si se ve B y no A, es el remuestreo del equipo: el navegador tira los
 * píxeles del trazo al encogerlo. Si no se ve ninguna de las dos, no es el
 * tamaño: algo está recoloreando o invirtiendo la página, y lo que hay que
 * mirar son las dos primeras líneas de la lista.
 */
export function DatosDePantalla({ className }: { className?: string }) {
  const [abierto, setAbierto] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className={
          "inline-flex items-center gap-1.5 text-xs text-muted underline decoration-dotted underline-offset-2 transition-colors hover:text-ink " +
          (className ?? "")
        }
      >
        <HelpCircle className="h-3.5 w-3.5" aria-hidden />
        ¿No se ve bien tu firma?
      </button>

      {abierto && <Panel onCerrar={() => setAbierto(false)} />}
    </>
  );
}

type Dato = { etiqueta: string; valor: string };

function Panel({ onCerrar }: { onCerrar: () => void }) {
  const [datos, setDatos] = useState<Dato[]>([]);
  const [copiado, setCopiado] = useState(false);
  const [muestra, setMuestra] = useState<HTMLImageElement | null>(null);
  const canvasB = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCerrar();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCerrar]);

  useEffect(() => {
    const pregunta = (consulta: string) => window.matchMedia(consulta).matches;

    // Las extensiones que oscurecen sitios dejan rastro en el documento: es
    // la forma de saber si hay uno repintando la página por encima.
    const repintado =
      document.documentElement.hasAttribute("data-darkreader-mode") ||
      document.documentElement.hasAttribute("data-darkreader-scheme") ||
      !!document.querySelector('style[class*="darkreader"]');

    setDatos([
      {
        etiqueta: "Alto contraste del sistema",
        valor: pregunta("(forced-colors: active)") ? "SÍ, activo" : "no",
      },
      {
        etiqueta: "Extensión que oscurece la web",
        valor: repintado ? "SÍ, detectada" : "no detectada",
      },
      {
        etiqueta: "Pide más contraste",
        valor: pregunta("(prefers-contrast: more)") ? "sí" : "no",
      },
      {
        etiqueta: "Tema del sistema",
        valor: pregunta("(prefers-color-scheme: dark)") ? "oscuro" : "claro",
      },
      {
        etiqueta: "Densidad / zoom",
        valor: `${(window.devicePixelRatio || 1).toFixed(2)}x`,
      },
      {
        etiqueta: "Ancho de la ventana",
        valor: `${window.innerWidth} px`,
      },
      {
        etiqueta: "Navegador",
        valor: navigator.userAgent.slice(0, 80),
      },
    ]);

    // Una rúbrica de mentira, con el mismo grosor de trazo que una de verdad.
    const lienzo = document.createElement("canvas");
    lienzo.width = 900;
    lienzo.height = 150;
    const ctx = lienzo.getContext("2d");
    if (!ctx) return;
    ctx.strokeStyle = "#141018";
    ctx.lineWidth = 4.4;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    for (let x = 20; x <= 880; x += 4) {
      const y = 75 + Math.sin(x / 60) * 45 + Math.sin(x / 17) * 8;
      if (x === 20) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    const img = new Image();
    img.onload = () => setMuestra(img);
    img.src = lienzo.toDataURL("image/png");
  }, []);

  useEffect(() => {
    if (muestra && canvasB.current) pintarFirmaReducida(canvasB.current, muestra);
  }, [muestra]);

  async function copiar() {
    const texto = datos.map((d) => `${d.etiqueta}: ${d.valor}`).join("\n");
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      // Sin portapapeles queda la lista en pantalla, que se puede fotografiar.
    }
  }

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-ink/40 p-4 backdrop-blur-[2px]"
      onClick={onCerrar}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="datos-titulo"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md overflow-hidden rounded-lg border border-line bg-surface shadow-pop"
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 id="datos-titulo" className="font-display text-lg font-semibold">
            Datos de tu pantalla
          </h2>
          <button
            onClick={onCerrar}
            aria-label="Cerrar"
            className="rounded p-1 text-muted transition-colors hover:bg-surface-2 hover:text-ink"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[70vh] overflow-y-auto p-5">
          <p className="text-sm text-muted">
            Si la firma se te pierde al hacerla pequeña, esto dice por qué.
          </p>

          {/* La prueba, con las dos muestras al mismo tamaño. */}
          <div className="mt-4 rounded border border-line bg-surface-2 p-3.5">
            <p className="text-xs font-medium">
              ¿Cuál de las dos rayas ves?
            </p>
            <div className="mt-3 flex items-center gap-5">
              <Muestra etiqueta="A">
                {muestra && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={muestra.src}
                    alt="Muestra A"
                    style={{ width: 54, height: 9 }}
                    className="block"
                  />
                )}
              </Muestra>
              <Muestra etiqueta="B">
                <canvas
                  ref={canvasB}
                  role="img"
                  aria-label="Muestra B"
                  style={{ width: 54, height: 9 }}
                  className="block"
                />
              </Muestra>
            </div>
            <p className="mt-3 text-xs text-muted">
              Las dos son la misma firma al mismo tamaño. <strong>Si ves la B
              y no la A</strong>, era tu equipo encogiendo la imagen, y ya está
              arreglado. <strong>Si no ves ninguna</strong>, mira las dos
              primeras líneas de abajo.
            </p>
          </div>

          <dl className="mt-4 divide-y divide-line rounded border border-line">
            {datos.map((d) => (
              <div
                key={d.etiqueta}
                className="flex items-baseline justify-between gap-3 px-3 py-2"
              >
                <dt className="shrink-0 text-xs text-muted">{d.etiqueta}</dt>
                <dd className="min-w-0 break-words text-right text-xs font-medium">
                  {d.valor}
                </dd>
              </div>
            ))}
          </dl>

          <button
            onClick={copiar}
            className="mt-4 inline-flex h-10 items-center gap-2 rounded border border-line-strong bg-surface px-3.5 text-sm font-medium transition-colors hover:bg-surface-2"
          >
            {copiado ? (
              <Check className="h-4 w-4 text-ok" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
            {copiado ? "Copiado" : "Copiar estos datos"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Muestra({
  etiqueta,
  children,
}: {
  etiqueta: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs font-medium text-muted">{etiqueta}</span>
      {/* Fondo blanco fijo: la hoja de un PDF siempre es blanca, y la prueba
          tiene que hacerse contra lo mismo. */}
      <span
        className="flex h-8 w-20 items-center justify-center rounded border border-line-strong"
        style={{ background: "#ffffff", forcedColorAdjust: "none" }}
      >
        {children}
      </span>
    </div>
  );
}
