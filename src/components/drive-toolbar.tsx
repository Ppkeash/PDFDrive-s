"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { Search, SlidersHorizontal, X } from "lucide-react";

const ESTADOS = [
  { valor: "borrador", etiqueta: "Borrador" },
  { valor: "en_firma", etiqueta: "En firma" },
  { valor: "firmado", etiqueta: "Firmado" },
  { valor: "archivado", etiqueta: "Archivado" },
];

const FECHAS = [
  { valor: "hoy", etiqueta: "Hoy" },
  { valor: "7", etiqueta: "Últimos 7 días" },
  { valor: "30", etiqueta: "Últimos 30 días" },
];

const ORDENES = [
  { valor: "reciente", etiqueta: "Más reciente primero" },
  { valor: "antiguo", etiqueta: "Más antiguo primero" },
  { valor: "nombre", etiqueta: "Nombre (A-Z)" },
  { valor: "estado", etiqueta: "Estado de firma" },
];

/**
 * Buscar, filtrar y ordenar.
 *
 * Todo se escribe en la URL en vez de guardarse en estado local, por tres
 * razones prácticas: la página sigue siendo componente de servidor (la
 * consulta se hace donde está la base, no en el navegador), un filtro se
 * puede compartir o dejar en favoritos, y volver atrás deshace el último
 * filtro en vez de salir de la pantalla.
 */
export function DriveToolbar({
  carpetaActual = null,
  hayCarpetas = false,
}: {
  carpetaActual?: string | null;
  hayCarpetas?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const q = params.get("q") ?? "";
  const estado = params.get("estado");
  const desde = params.get("desde");
  const orden = params.get("orden") ?? "reciente";
  const soloAqui = params.get("enCarpeta") === "1";

  const [texto, setTexto] = useState(q);
  const [filtrosAbiertos, setFiltrosAbiertos] = useState(
    Boolean(estado || desde)
  );

  // El campo de búsqueda manda mientras se escribe, pero si la URL cambia por
  // fuera (atrás, un enlace, limpiar filtros) el campo tiene que seguirla.
  useEffect(() => setTexto(q), [q]);

  /** Escribe parámetros conservando los demás; `null` borra uno. */
  function navegar(cambios: Record<string, string | null>) {
    const siguiente = new URLSearchParams(params.toString());
    for (const [clave, valor] of Object.entries(cambios)) {
      if (valor === null || valor === "") siguiente.delete(clave);
      else siguiente.set(clave, valor);
    }
    const cadena = siguiente.toString();
    router.push(cadena ? `${pathname}?${cadena}` : pathname);
  }

  // Un parámetro por tecla pulsada llenaría el historial y dispararía una
  // consulta por letra; con el retardo, se busca cuando se deja de escribir.
  useEffect(() => {
    if (texto === q) return;
    const t = setTimeout(() => navegar({ q: texto.trim() || null }), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [texto]);

  const filtrosActivos = [
    estado && {
      clave: "estado",
      etiqueta: ESTADOS.find((e) => e.valor === estado)?.etiqueta ?? estado,
    },
    desde && {
      clave: "desde",
      etiqueta: FECHAS.find((f) => f.valor === desde)?.etiqueta ?? desde,
    },
    q && { clave: "q", etiqueta: `«${q}»` },
  ].filter(Boolean) as { clave: string; etiqueta: string }[];

  return (
    <div className="mt-6 flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
            aria-hidden
          />
          <input
            type="search"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder="Buscar por nombre…"
            aria-label="Buscar documentos por nombre"
            className="h-10 w-full rounded border border-line-strong bg-surface pl-9 pr-9 text-sm outline-none transition-colors placeholder:text-muted/60 focus:border-seal"
          />
          {texto && (
            <button
              onClick={() => {
                setTexto("");
                navegar({ q: null, enCarpeta: null });
              }}
              aria-label="Borrar la búsqueda"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted transition-colors hover:bg-surface-2 hover:text-ink"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <button
          onClick={() => setFiltrosAbiertos((v) => !v)}
          aria-expanded={filtrosAbiertos}
          className={cn(
            "inline-flex h-10 shrink-0 items-center gap-2 rounded border px-3 text-sm font-medium transition-colors",
            estado || desde
              ? "border-seal bg-seal-soft text-seal"
              : "border-line-strong bg-surface hover:bg-surface-2"
          )}
        >
          <SlidersHorizontal className="h-4 w-4" /> Filtros
        </button>

        <label className="inline-flex shrink-0 items-center gap-2">
          <span className="sr-only">Ordenar por</span>
          <select
            value={orden}
            onChange={(e) => navegar({ orden: e.target.value })}
            className="h-10 rounded border border-line-strong bg-surface px-2.5 text-sm outline-none transition-colors focus:border-seal"
          >
            {ORDENES.map((o) => (
              <option key={o.valor} value={o.valor}>
                {o.etiqueta}
              </option>
            ))}
          </select>
        </label>
      </div>

      {filtrosAbiertos && (
        <div className="flex flex-col gap-2.5 rounded border border-line bg-surface p-3.5">
          <Grupo titulo="Estado de firma">
            {ESTADOS.map((e) => (
              <Chip
                key={e.valor}
                activo={estado === e.valor}
                onClick={() =>
                  navegar({ estado: estado === e.valor ? null : e.valor })
                }
              >
                {e.etiqueta}
              </Chip>
            ))}
          </Grupo>

          <Grupo titulo="Fecha de subida">
            {FECHAS.map((f) => (
              <Chip
                key={f.valor}
                activo={desde === f.valor}
                onClick={() =>
                  navegar({ desde: desde === f.valor ? null : f.valor })
                }
              >
                {f.etiqueta}
              </Chip>
            ))}
          </Grupo>

          {/* Buscar mira toda la cuenta, que es lo que uno espera al buscar.
              Pero si se estaba trabajando dentro de una carpeta, conviene
              poder encerrar la búsqueda ahí. */}
          {q && (carpetaActual || hayCarpetas) && (
            <Grupo titulo="Dónde buscar">
              <Chip activo={!soloAqui} onClick={() => navegar({ enCarpeta: null })}>
                En toda la cuenta
              </Chip>
              {carpetaActual && (
                <Chip activo={soloAqui} onClick={() => navegar({ enCarpeta: "1" })}>
                  Solo en esta carpeta
                </Chip>
              )}
            </Grupo>
          )}
        </div>
      )}

      {filtrosActivos.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {filtrosActivos.map((f) => (
            <button
              key={f.clave}
              onClick={() =>
                navegar(
                  f.clave === "q"
                    ? { q: null, enCarpeta: null }
                    : { [f.clave]: null }
                )
              }
              className="inline-flex items-center gap-1.5 rounded-full border border-seal bg-seal-soft px-2.5 py-1 text-xs font-medium text-seal transition-opacity hover:opacity-80"
            >
              {f.etiqueta}
              <X className="h-3 w-3" aria-hidden />
              <span className="sr-only">Quitar este filtro</span>
            </button>
          ))}
          <button
            onClick={() =>
              navegar({ q: null, estado: null, desde: null, enCarpeta: null })
            }
            className="text-xs font-medium text-muted underline decoration-dotted underline-offset-2 transition-colors hover:text-ink"
          >
            Limpiar filtros
          </button>
        </div>
      )}
    </div>
  );
}

function Grupo({
  titulo,
  children,
}: {
  titulo: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-micro uppercase text-muted">{titulo}</span>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

function Chip({
  activo,
  onClick,
  children,
}: {
  activo: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={activo}
      className={cn(
        "h-8 rounded-full border px-3 text-xs font-medium transition-colors",
        activo
          ? "border-seal bg-seal text-seal-ink"
          : "border-line-strong bg-surface hover:bg-surface-2"
      )}
    >
      {children}
    </button>
  );
}
