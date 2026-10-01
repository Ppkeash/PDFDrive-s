"use client";

import { useState } from "react";
import { PdfViewer, type SignField } from "@/components/pdf-viewer";
import { RubricPad } from "@/components/rubric-pad";
import { Spinner } from "@/components/spinner";
import { ShieldCheck } from "lucide-react";

export interface DatosDelEnlace {
  documento: string;
  etiqueta: string | null;
  pdfUrl: string;
  campo: { page: number; x: number; y: number; w: number; h: number } | null;
}

/**
 * Firma por enlace, sin cuenta.
 *
 * Son tres pasos y en este orden a propósito: primero el nombre, después leer
 * el documento, y la rúbrica de última. Pedir el nombre al final, con la firma
 * ya trazada, invita a escribir cualquier cosa para salir del paso; pedirlo de
 * entrada lo convierte en parte de identificarse.
 */
export function FirmarCliente({
  token,
  datos,
}: {
  token: string;
  datos: DatosDelEnlace;
}) {
  const [nombre, setNombre] = useState("");
  const [identificado, setIdentificado] = useState(false);
  const [padAbierto, setPadAbierto] = useState(false);
  const [firmando, setFirmando] = useState(false);
  const [listo, setListo] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const campos: SignField[] = datos.campo
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

  async function firmar(rubrica: string) {
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
            rubric: rubrica,
          }),
        }
      );
      const data = await r.json();

      if (!r.ok || data?.error) {
        setFirmando(false);
        setPadAbierto(false);
        return setError(data?.error ?? "No se pudo firmar.");
      }

      setPadAbierto(false);
      setFirmando(false);
      setListo(true);
    } catch {
      setFirmando(false);
      setPadAbierto(false);
      setError("No se pudo conectar. Revisa tu internet y vuelve a intentar.");
    }
  }

  if (listo) {
    return (
      <Cartel
        titulo="Listo, quedó firmado"
        detalle={`Tu firma quedó registrada en "${datos.documento}" a nombre de ${nombre.trim()}. Este enlace ya no sirve otra vez.`}
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

      {!identificado ? (
        <section className="mt-8 rounded-lg border border-line bg-surface p-6">
          <h2 className="font-display text-lg font-semibold">
            ¿Quién va a firmar?
          </h2>
          <p className="mt-1.5 text-sm text-muted">
            Escribe tu nombre completo. Es el que va a quedar registrado junto a
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
                Nombre completo
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
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-wait" aria-hidden />
            <span>
              Vas a firmar como{" "}
              <strong className="font-medium text-ink">{nombre.trim()}</strong>.
              Lee el documento antes de firmar — después no se puede deshacer
              desde este enlace.
            </span>
          </p>

          <div className="mt-5 flex-1">
            <PdfViewer url={datos.pdfUrl} fields={campos} />
          </div>

          <div className="sticky bottom-0 mt-5 flex flex-col gap-2 bg-paper/95 py-4 backdrop-blur">
            <button
              onClick={() => setPadAbierto(true)}
              className="inline-flex h-12 w-full items-center justify-center gap-2 rounded bg-seal px-4 text-sm font-medium text-seal-ink transition-opacity hover:opacity-90"
            >
              Firmar documento
            </button>
            <button
              onClick={() => setIdentificado(false)}
              className="text-center text-sm text-muted underline underline-offset-4 hover:text-ink"
            >
              No soy {nombre.trim()}
            </button>
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
        busy={firmando}
        onCancel={() => setPadAbierto(false)}
        onConfirm={firmar}
        title={`Dibuja tu firma, ${nombre.trim().split(" ")[0]}`}
      />

      {firmando && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/20">
          <div className="flex items-center gap-2 rounded bg-surface px-4 py-3 text-sm shadow-lg">
            <Spinner /> Firmando…
          </div>
        </div>
      )}
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
