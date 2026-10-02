"use client";

import { useRef, useState } from "react";
import {
  PdfViewer,
  DEFAULT_FIELD,
  enMilimetros,
  escalarCaja,
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
  // El visor avisa si no pudo abrir el documento; sin eso, la única salida
  // que se ofrecía era un enlace al PDF suelto, que no deja firmar.
  const [fallaPdf, setFallaPdf] = useState<string | null>(null);
  const [intento, setIntento] = useState(0);

  // Tamaños de página en puntos PDF: sin esto la firma aparecería en una
  // esquina al azar en vez de centrada.
  const tamanos = useRef<{ width: number; height: number }[]>([]);

  // Si escalar ya no cambia nada, el botón correspondiente se apaga.
  const puedeAchicar = pendiente
    ? escalarCaja(pendiente.box, 0.85) !== pendiente.box
    : false;
  const puedeAgrandar = pendiente
    ? escalarCaja(pendiente.box, 1.18) !== pendiente.box
    : false;

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
   * Arrastrar una esquina es incómodo en un computador e inviable en un
   * celular, que es donde más gente va a firmar. La firma se escala entera
   * desde su esquina inferior izquierda, que es la que la gente usa para
   * alinearla con un renglón.
   *
   * El cálculo vive en `escalarCaja` porque antes estaba repetido aquí y en
   * el documento con sesión, los dos solo ponían suelo al ancho, y con una
   * firma ancha el alto bajaba hasta hacerse invisible.
   */
  function escalar(factor: number) {
    setPendiente((p) => (p ? { ...p, box: escalarCaja(p.box, factor) } : p));
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
      setError("No se pudo conectar. Verifica tu conexión e inténtalo de nuevo.");
    }
  }

  if (listo) {
    return (
      <Cartel
        titulo="Documento firmado"
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
          <h2 className="font-display text-lg font-semibold">
            Identificación del firmante
          </h2>
          <p className="mt-1.5 text-sm text-muted">
            Selecciona tu nombre en la lista. Cada nombre admite una sola firma.
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
                        firmado
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
            Este documento está dirigido a ti
          </h2>
          <p className="mt-1.5 text-sm text-muted">
            Quien te lo envió preparó el espacio de firma a nombre de{" "}
            <strong className="font-medium text-ink">{cupos[0].nombre}</strong>.
            Si no eres esa persona, comunícaselo antes de continuar.
          </p>

          <button
            onClick={() => setIdentificado(true)}
            className="mt-5 inline-flex h-11 w-full items-center justify-center rounded bg-seal px-4 text-sm font-medium text-seal-ink transition-opacity hover:opacity-90"
          >
            Confirmar y ver el documento
          </button>
        </section>
      ) : !identificado ? (
        <section className="mt-8 rounded-lg border border-line bg-surface p-6">
          <h2 className="font-display text-lg font-semibold">
            ¿Quién va a firmar?
          </h2>
          <p className="mt-1.5 text-sm text-muted">
            Escribe tu nombre y apellido. Es el que quedará registrado junto a
            tu firma.
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
                placeholder="Como aparece en tu documento de identidad"
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
                  Ubícala en el renglón que te corresponde y ajusta el tamaño
                  si es necesario. Una vez confirmada no podrás moverla desde
                  este enlace.
                </>
              ) : (
                <>
                  Firmarás como{" "}
                  <strong className="font-medium text-ink">
                    {nombre.trim()}
                  </strong>
                  . Revisa el documento antes de firmar.
                </>
              )}
            </span>
          </p>

          {fallaPdf && (
            <div className="mt-4 rounded border border-danger/40 bg-surface p-4">
              <h2 className="font-display text-base font-semibold">
                No se pudo abrir el documento
              </h2>
              <p className="mt-1.5 text-sm text-muted">
                Generalmente se debe a la conexión. Inténtalo de nuevo; si
                sigue sin aparecer, descárgalo para leerlo e informa a quien te
                envió el enlace: para firmar es necesario visualizarlo aquí.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  onClick={() => {
                    setFallaPdf(null);
                    setIntento((n) => n + 1);
                  }}
                  className="inline-flex h-10 items-center justify-center rounded bg-seal px-4 text-sm font-medium text-seal-ink transition-opacity hover:opacity-90"
                >
                  Reintentar
                </button>
                <a
                  href={datos.pdfUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-10 items-center justify-center rounded border border-line-strong bg-surface px-4 text-sm font-medium transition-colors hover:bg-surface-2"
                >
                  Descargar para leerlo
                </a>
              </div>
            </div>
          )}

          <div className="mt-5 flex-1">
            <PdfViewer
              key={intento}
              url={datos.pdfUrl}
              fields={campoFijo}
              pending={pendiente}
              onPendingChange={(page, box) =>
                setPendiente((p) => (p ? { ...p, page, box } : p))
              }
              onPagesReady={(p) => {
                tamanos.current = p;
              }}
              onError={setFallaPdf}
            />
          </div>

          <div className="sticky bottom-0 mt-5 flex flex-col gap-2 bg-paper/95 py-4 backdrop-blur">
            {pendiente ? (
              <>
                <div className="flex items-center justify-center gap-2">
                  <button
                    onClick={() => escalar(0.85)}
                    // Un botón que no hace nada es peor que un botón ausente:
                    // se pulsa otra vez, y otra, buscando el efecto.
                    disabled={firmando || !puedeAchicar}
                    aria-label="Reducir el tamaño de la firma"
                    className="inline-flex h-10 w-12 items-center justify-center rounded border border-line-strong bg-surface transition-colors hover:bg-surface-2 disabled:opacity-40"
                  >
                    <Minus className="h-4 w-4" />
                  </button>
                  <span className="tnum min-w-[7.5rem] text-center text-sm text-muted">
                    {enMilimetros(pendiente.box.w)} × {enMilimetros(pendiente.box.h)} mm
                  </span>
                  <button
                    onClick={() => escalar(1.18)}
                    disabled={firmando || !puedeAgrandar}
                    aria-label="Aumentar el tamaño de la firma"
                    className="inline-flex h-10 w-12 items-center justify-center rounded border border-line-strong bg-surface transition-colors hover:bg-surface-2 disabled:opacity-40"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
                {!puedeAchicar && (
                  <p className="text-center text-xs text-muted">
                    Es el tamaño más pequeño en el que la firma se sigue
                    leyendo. Para afinarla más, arrastra la esquina.
                  </p>
                )}

                <button
                  onClick={confirmarFirma}
                  disabled={firmando}
                  className="inline-flex h-12 w-full items-center justify-center gap-2 rounded bg-seal px-4 text-sm font-medium text-seal-ink transition-opacity hover:opacity-90 disabled:opacity-60"
                >
                  {firmando && <Spinner />}
                  {firmando ? "Firmando…" : "Confirmar la firma en esta posición"}
                </button>
                <button
                  onClick={() => setPendiente(null)}
                  disabled={firmando}
                  className="text-center text-sm text-muted underline underline-offset-4 hover:text-ink disabled:opacity-50"
                >
                  Trazar la firma de nuevo
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => setPadAbierto(true)}
                  disabled={Boolean(fallaPdf)}
                  title={
                    fallaPdf
                      ? "Es necesario visualizar el documento para poder firmarlo"
                      : undefined
                  }
                  className="inline-flex h-12 w-full items-center justify-center gap-2 rounded bg-seal px-4 text-sm font-medium text-seal-ink transition-opacity hover:opacity-90 disabled:opacity-50"
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
                  {conLista
                    ? "Seleccionar otro nombre"
                    : `No soy ${nombre.trim()}`}
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
        title={`Traza tu firma, ${nombre.trim().split(" ")[0]}`}
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
