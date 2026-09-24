"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Guilloche } from "@/components/guilloche";
import { Spinner } from "@/components/spinner";
import { canjearCodigo } from "./actions";

/**
 * Registro con código de invitación.
 *
 * El orden va al revés de lo esperable y es a propósito (ver migración
 * `0013`): con Google no hay dónde escribir un código durante el login, y
 * cuando vuelve el OAuth la cuenta ya está creada. Así que primero se canjea
 * el código declarando el correo, y solo entonces se ofrece entrar con
 * Google. Por eso son dos pasos visibles y no un formulario de uno.
 */
export default function RegistroPage() {
  const supabase = createClient();
  const [codigo, setCodigo] = useState("");
  const [email, setEmail] = useState("");
  const [habilitado, setHabilitado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  async function handleCanje(e: React.FormEvent) {
    e.preventDefault();
    setCargando(true);
    setError(null);

    const r = await canjearCodigo(codigo, email);
    setCargando(false);

    if (!r.ok) return setError(r.mensaje ?? "No se pudo validar el código.");
    setHabilitado(true);
  }

  async function handleGoogle() {
    setError(null);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${location.origin}/auth/callback?next=/drive`,
        // Pista para Google: propone directamente el correo que se declaró.
        // Es comodidad, no seguridad -- quien filtra es el trigger de la base.
        queryParams: { login_hint: email },
      },
    });
    if (error) setError(error.message);
  }

  return (
    <main className="grid min-h-dvh lg:grid-cols-[1.05fr_1fr]">
      <section className="relative hidden overflow-hidden bg-surface-2 lg:flex lg:flex-col lg:justify-between lg:p-14">
        <div className="absolute inset-0 flex items-center justify-center">
          <Guilloche className="max-w-[36rem] opacity-90" />
        </div>
        <div className="relative">
          <Wordmark />
        </div>
        <div className="relative max-w-sm">
          <h2 className="font-display text-2xl font-semibold">
            Crea tu cuenta con el código de tu equipo.
          </h2>
          <p className="mt-3 text-sm text-muted">
            El código lo reparte quien administra FirmaDrive donde trabajas. Sin
            él no se puede crear una cuenta.
          </p>
        </div>
      </section>

      <section className="flex flex-col justify-center px-6 py-14 sm:px-12">
        <div className="mx-auto w-full max-w-sm">
          <div className="lg:hidden">
            <Wordmark />
          </div>

          <h1 className="mt-10 font-display text-3xl font-semibold lg:mt-0">
            Crear cuenta
          </h1>

          {!habilitado ? (
            <>
              <p className="mt-2 text-sm text-muted">
                Escribe el código que te dieron y el correo con el que vas a
                entrar.
              </p>

              <form onSubmit={handleCanje} className="mt-8 flex flex-col gap-4">
                <Campo
                  id="codigo"
                  label="Código de invitación"
                  value={codigo}
                  onChange={setCodigo}
                  placeholder="el que te dieron en el trabajo"
                  autoComplete="off"
                />
                <Campo
                  id="email"
                  label="Tu correo"
                  type="email"
                  value={email}
                  onChange={setEmail}
                  placeholder="tu@correo.com"
                  autoComplete="email"
                />

                <button
                  type="submit"
                  disabled={cargando}
                  className="mt-1 inline-flex h-11 items-center justify-center gap-2 rounded bg-seal px-4 text-sm font-medium text-seal-ink transition-opacity hover:opacity-90 disabled:opacity-60"
                >
                  {cargando && <Spinner />}
                  {cargando ? "Comprobando…" : "Continuar"}
                </button>
              </form>
            </>
          ) : (
            <>
              <p className="mt-2 text-sm text-muted">
                Listo. Ahora entra con la cuenta de Google de{" "}
                <strong className="font-medium text-ink">{email}</strong>.
              </p>

              <button
                onClick={handleGoogle}
                className="mt-8 inline-flex h-11 w-full items-center justify-center gap-2 rounded border border-line-strong bg-surface px-4 text-sm font-medium transition-colors hover:bg-surface-2"
              >
                <GoogleGlyph /> Continuar con Google
              </button>

              <p className="mt-4 text-sm text-muted">
                Tiene que ser ese mismo correo. Si entras con otra cuenta de
                Google, el registro se rechaza.
              </p>

              <button
                onClick={() => {
                  setHabilitado(false);
                  setError(null);
                }}
                className="mt-5 text-sm text-muted underline underline-offset-4 hover:text-ink"
              >
                Usar otro correo
              </button>
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

          <p className="mt-8 border-t border-line pt-5 text-sm text-muted">
            ¿Ya tienes cuenta?{" "}
            <Link
              href="/login"
              className="font-medium text-seal underline decoration-seal/30 underline-offset-4 hover:decoration-seal"
            >
              Entrar
            </Link>
          </p>
        </div>
      </section>
    </main>
  );
}

function Wordmark() {
  return (
    <div className="flex items-center gap-2.5">
      <SealMark />
      <span className="font-display text-lg font-semibold tracking-tight">
        FirmaDrive
      </span>
    </div>
  );
}

/** Sello de lacre reducido a su forma mínima. */
function SealMark({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="10" fill="rgb(var(--seal))" />
      <circle
        cx="12"
        cy="12"
        r="7"
        fill="none"
        stroke="rgb(var(--seal-ink))"
        strokeOpacity="0.55"
        strokeWidth="0.75"
      />
      <path
        d="M8.5 13.2c1.6.9 2.6-2.4 4-1.7 1 .5.3 2.4 1.6 2.2.8-.1 1.2-.8 1.4-1.5"
        fill="none"
        stroke="rgb(var(--seal-ink))"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

function Campo({
  id,
  label,
  type = "text",
  value,
  onChange,
  placeholder,
  autoComplete,
}: {
  id: string;
  label: string;
  type?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoComplete?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-micro uppercase text-muted">
        {label}
      </label>
      <input
        id={id}
        type={type}
        required
        autoComplete={autoComplete}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-11 rounded border border-line-strong bg-surface px-3 text-sm outline-none transition-colors placeholder:text-muted/60 focus:border-seal"
      />
    </div>
  );
}

function GoogleGlyph() {
  return (
    <svg viewBox="0 0 18 18" className="h-4 w-4" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.97 10.72a5.41 5.41 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z"
      />
    </svg>
  );
}
