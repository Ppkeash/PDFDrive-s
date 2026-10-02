"use client";

import { useRef, useState } from "react";
import {
  PdfViewer,
  DEFAULT_FIELD,
  type FieldBox,
  type PendingSignature,
  type SignField,
} from "@/components/pdf-viewer";
import { RubricPad } from "@/components/rubric-pad";
import { Spinner } from "@/components/spinner";
import { Minus, Plus, ShieldCheck } from "lucide-react";

export interface Cupo {
  id: string;
  nombre: string;
  firmado: boolean;
}

export interface DatosDelEnlace {
  kind: "individual" | "grupal";
  documento: string;
  etiqueta: string | null;
  pdfUrl: string;
  campo: { page: number; x: number; y: number; w: number; h: number } | null;
  cupos: Cupo[] | null;
}

/**
 * Marca del navegador, para notar si dos firmas del mismo enlace salen del
 * mismo equipo. No bloquea nada: un acta firmada por todos en la misma tablet,
 * pasándola por la mesa, es un uso normal. Solo queda anotado para quien
 * después revise el documento.
 */
function marcaDelDispositivo(): string | null {
  try {
    const clave = "fd_dispositivo";
    let v = localStorage.getItem(clave);
    if (!v) {
      v = crypto.randomUUID();
      localStorage.setItem(clave, v);
    }
    return v;
  } catch {
    return null;
  }
}

/**
 * Firma por enlace, sin cuenta.
 *
 * El orden es a propósito: primero el nombre, después leer el documento, y la
 * firma de última. Pedir el nombre al final, con la rúbrica ya trazada, invita
 * a escribir cualquier cosa para salir del paso.
 *
 * La posición la escoge quien firma, arrastrando su rúbrica hasta el renglón
 * que le toca. No hay recuadros preparados de antemano: en un acta cada quien
 * sabe dónde va, y obligar a quien envía a dibujar veinte casillas antes de
 * mandar nada era más trabajo del que ahorraba.
 */
export function FirmarCliente({
  token,
  datos,
}: {
  token: string;
  datos: DatosDelEnlace;
}) {
  const cupos = datos.cupos ?? [];
  const conLista = cupos.length > 1;
  const unaSolaPersona = cupos.length === 1;

  const [nombre, setNombre] = useState(unaSolaPersona ? cupos[0].nombre : "");
  const [cupoElegido, setCupoElegido] = useState<string | null>(
    unaSolaPersona ? cupos[0].id : null
  );
  const [identificado, setIdentificado] = useState(false);
  const [padAbierto, setPadAbierto] = useState(false);
  const [pendiente, setPendiente] = useState<PendingSignature | null>(null);
  const [firmando, setFirmando] = useState(false);
  const [listo, setListo] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Tamaños de página en puntos PDF: sin esto la firma aparecería en una
  // esquina al azar en vez de centrada.
  const tamanos = useRef<{ width: number; height: number }[]>([]);

  const campoFijo: SignField[] = datos.campo
    ? [
        {
          id: "destino",
          page: datos.campo.page,
          x: datos.campo.x,
          y: datos.campo.y,
          w: datos.campo.w,
          h: datos.campo.h,
          assigned_email: null,
        },
      ]
    : [];

  /** Del trazo sale el ancho; el alto es fijo, para que todas se vean parejas. */
  async function medirRubrica(png: string): Promise<FieldBox> {
    const size = await new Promise<{ w: number; h: number }>((resolve) => {
      const img = new Image();
      img.onload = () => {
        const h = DEFAULT_FIELD.h;
        const ratio = img.width / Math.max(img.height, 1);
        resolve({ w: Math.min(340, Math.max(90, h * ratio)), h });
      };
      img.onerror = () => resolve({ w: DEFAULT_FIELD.w, h: DEFAULT_FIELD.h });
      img.src = png;
    });

    const pagina = tamanos.current[0] ?? { width: 595, height: 842 };

    // Cabe en la hoja: en un PDF angosto la firma nacía más ancha que la
    // página, se salía por el borde y no había forma de colocarla.
    const maxW = pagina.width * 0.8;
    const w = Math.min(size.w, maxW);
    const h = size.h * (w / size.w);

    return {
      w,
      h,
      x: (pagina.width - w) / 2,
      y: pagina.height * 0.3,
    };
  }

  async function alTrazar(png: string) {
    setPendiente({ src: png, page: 1, box: await medirRubrica(png) });
    setPadAbierto(false);
  }

  /**
   * Escalar sin tocar el tirador de la esquina.
   *
   * Arrastrar una esquina de 14 píxeles es incómodo en un computador e
   * inviable en un celular, que es donde más gente va a firmar. La firma se
   * escala entera desde su esquina inferior izquierda, que es la que la gente
   * usa para alinearla con un renglón.
   */
  function escalar(factor: number) {
    setPendiente((p) => {
      if (!p) return p;
      const w = Math.min(400, Math.max(24, p.box.w * factor));
      const h = (w / p.box.w) * p.box.h;
      return { ...p, box: { ...p.box, w, h } };
    });
  }

  async function confirmarFirma() {
    if (!pendiente) return;
    setFirmando(true);
    setError(null);

    try {
      const r = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/sign-pdf`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
          },
          body: JSON.stringify({
            linkToken: token,
            signerName: nombre.trim(),
            slotId: cupoElegido,
            deviceId: marcaDelDispositivo(),
            rubric: pendiente.src,
            box: { page: pendiente.page, ...pendiente.box },
            fit: "fill",
          }),
        }
      );
      const data = await r.json();

      if (!r.ok || data?.error) {
        setFirmando(false);
        return setError(data?.error ?? "No se pudo firmar.");
      }

      setFirmando(false);
      setListo(true);
    } catch {
      setFirmando(false);
      setError("No se pudo conectar. Revisa tu internet y vuelve a intentar.");
    }
  }

  if (listo) {
    return (
      <Cartel
        titulo="Listo, quedó firmado"
        detalle={`Tu firma quedó registrada en "${datos.documento}" a nombre de ${nombre.trim()}.`}
        ok
      />
    );
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-3xl flex-col px-5 py-6 sm:px-8">
      <header className="flex flex-col gap-1">
        <p className="text-micro uppercase text-muted">Firmar documento</p>
        <h1 className="font-display text-2xl font-semibold">
          {datos.documento}
        </h1>
        {datos.etiqueta && (
          <p className="text-sm text-muted">Enviado para: {datos.etiqueta}</p>
        )}
      </header>

      {!identificado && conLista ? (
        <section className="mt-8 rounded-lg border border-line bg-surface p-6">
          <h2 className="font-display text-lg font-semibold">¿Quién eres?</h2>
          <p className="mt-1.5 text-sm text-muted">
            Escoge tu nombre de la lista. Cada nombre se puede usar una sola
            vez.
          </p>

          <ul className="mt-5 flex flex-col gap-1.5">
            {cupos.map((c) => {
              const elegido = cupoElegido === c.id;
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    disabled={c.firmado}
                    onClick={() => {
                      setCupoElegido(c.id);
                      setNombre(c.nombre);
                    }}
                    className={`flex w-full items-center justify-between gap-3 rounded border px-3.5 py-3 text-left text-sm transition-colors ${
                      c.firmado
                        ? "cursor-not-allowed border-line bg-surface-2 text-muted"
                        : elegido
                          ? "border-seal bg-surface-2"
                          : "border-line-strong bg-surface hover:bg-surface-2"
                    }`}
                  >
                    <span className="min-w-0 truncate">{c.nombre}</span>
                    {c.firmado && (
                      <span className="shrink-0 text-micro uppercase text-muted">
                        ya firmó
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>

          <button
            onClick={() => cupoElegido && setIdentificado(true)}
            disabled={!cupoElegido}
            className="mt-5 inline-flex h-11 w-full items-center justify-center rounded bg-seal px-4 text-sm font-medium text-seal-ink transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            Ver el documento
          </button>
        </section>
      ) : !identificado && unaSolaPersona ? (
        <section className="mt-8 rounded-lg border border-line bg-surface p-6">
          <h2 className="font-display text-lg font-semibold">
            Este documento es para ti
          </h2>
          <p className="mt-1.5 text-sm text-muted">
            Quien te lo envió preparó la firma a nombre de{" "}
            <strong className="font-medium text-ink">{cupos[0].nombre}</strong>.
            Si no eres tú, avísale antes de continuar.
          </p>

          <button
            onClick={() => setIdentificado(true)}
            className="mt-5 inline-flex h-11 w-full items-center justify-center rounded bg-seal px-4 text-sm font-medium text-seal-ink transition-opacity hover:opacity-90"
          >
            Sí, soy yo — ver el documento
          </button>
        </section>
      ) : !identificado ? (
        <section className="mt-8 rounded-lg border border-line bg-surface p-6">
          <h2 className="font-display text-lg font-semibold">
            ¿Quién va a firmar?
          </h2>
          <p className="mt-1.5 text-sm text-muted">
            Escribe tu nombre y apellido. Es el que va a quedar registrado junto
            a tu firma.
          </p>

          <form
            className="mt-5 flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (nombre.trim().length >= 3) setIdentificado(true);
            }}
          >
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="nombre"
                className="text-micro uppercase text-muted"
              >
                Nombre y apellido
              </label>
              <input
                id="nombre"
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                required
                minLength={3}
                maxLength={120}
                autoComplete="name"
                placeholder="Como aparece en tu cédula"
                className="h-11 rounded border border-line-strong bg-surface px-3 text-sm outline-none transition-colors placeholder:text-muted/60 focus:border-seal"
              />
            </div>

            <button
              type="submit"
              disabled={nombre.trim().length < 3}
              className="inline-flex h-11 items-center justify-center rounded bg-seal px-4 text-sm font-medium text-seal-ink transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              Ver el documento
            </button>
          </form>
        </section>
      ) : (
        <>
          <p className="mt-5 flex gap-2.5 rounded border-l-2 border-wait bg-wait-soft px-4 py-3 text-sm text-muted">
            <ShieldCheck
              className="mt-0.5 h-4 w-4 shrink-0 text-wait"
              aria-hidden
            />
            <span>
              {pendiente ? (
                <>
                  Arrástrala hasta el renglón que te corresponde y ajústale
                  el tamaño si hace falta. Después no se puede mover desde este
                  enlace.
                </>
              ) : (
                <>
                  Vas a firmar como{" "}
                  <strong className="font-medium text-ink">
                    {nombre.trim()}
                  </strong>
                  . Lee el documento antes de firmar.
                </>
              )}
            </span>
          </p>

          <p className="mt-3 text-right text-xs text-muted">
            ¿No se ve el documento?{" "}
            <a
              href={datos.pdfUrl}
              target="_blank"
              rel="noreferrer"
              className="font-medium text-seal underline decoration-seal/30 underline-offset-4 hover:decoration-seal"
            >
              Ábrelo en otra pestaña
            </a>
          </p>

          <div className="mt-2 flex-1">
            <PdfViewer
              url={datos.pdfUrl}
              fields={campoFijo}
              pending={pendiente}
              onPendingChange={(page, box) =>
                setPendiente((p) => (p ? { ...p, page, box } : p))
              }
              onPagesReady={(p) => {
                tamanos.current = p;
              }}
            />
          </div>

          <div className="sticky bottom-0 mt-5 flex flex-col gap-2 bg-paper/95 py-4 backdrop-blur">
            {pendiente ? (
              <>
                <div className="flex items-center justify-center gap-2">
                  <button
                    onClick={() => escalar(0.85)}
                    disabled={firmando}
                    aria-label="Hacer la firma más pequeña"
                    className="inline-flex h-10 w-12 items-center justify-center rounded border border-line-strong bg-surface transition-colors hover:bg-surface-2 disabled:opacity-50"
                  >
                    <Minus className="h-4 w-4" />
                  </button>
                  <span className="text-sm text-muted">Tamaño</span>
                  <button
                    onClick={() => escalar(1.18)}
                    disabled={firmando}
                    aria-label="Hacer la firma más grande"
                    className="inline-flex h-10 w-12 items-center justify-center rounded border border-line-strong bg-surface transition-colors hover:bg-surface-2 disabled:opacity-50"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>

                <button
                  onClick={confirmarFirma}
                  disabled={firmando}
                  className="inline-flex h-12 w-full items-center justify-center gap-2 rounded bg-seal px-4 text-sm font-medium text-seal-ink transition-opacity hover:opacity-90 disabled:opacity-60"
                >
                  {firmando && <Spinner />}
                  {firmando ? "Firmando…" : "Confirmar firma aquí"}
                </button>
                <button
                  onClick={() => setPendiente(null)}
                  disabled={firmando}
                  className="text-center text-sm text-muted underline underline-offset-4 hover:text-ink disabled:opacity-50"
                >
                  Volver a dibujarla
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => setPadAbierto(true)}
                  className="inline-flex h-12 w-full items-center justify-center gap-2 rounded bg-seal px-4 text-sm font-medium text-seal-ink transition-opacity hover:opacity-90"
                >
                  Firmar documento
                </button>
                <button
                  onClick={() => {
                    setIdentificado(false);
                    if (conLista) setCupoElegido(null);
                  }}
                  className="text-center text-sm text-muted underline underline-offset-4 hover:text-ink"
                >
                  {conLista ? "Escoger otro nombre" : `No soy ${nombre.trim()}`}
                </button>
              </>
            )}
          </div>
        </>
      )}

      {error && (
        <p
          role="alert"
          className="mt-5 rounded border-l-2 border-danger bg-surface-2 px-3 py-2 text-sm text-danger"
        >
          {error}
        </p>
      )}

      <RubricPad
        open={padAbierto}
        onCancel={() => setPadAbierto(false)}
        onConfirm={alTrazar}
        title={`Dibuja tu firma, ${nombre.trim().split(" ")[0]}`}
        confirmLabel="Continuar"
      />
    </div>
  );
}

export function Cartel({
  titulo,
  detalle,
  ok = false,
}: {
  titulo: string;
  detalle: string;
  ok?: boolean;
}) {
  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <div
        className={`max-w-sm rounded-lg border bg-surface p-7 text-center ${
          ok ? "border-seal" : "border-dashed border-line-strong"
        }`}
      >
        <h1 className="font-display text-xl font-semibold">{titulo}</h1>
        <p className="mt-2 text-sm text-muted">{detalle}</p>
      </div>
    </main>
  );
}
