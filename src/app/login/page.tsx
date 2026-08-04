"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Guilloche } from "@/components/guilloche";
import { Spinner } from "@/components/spinner";

// El botón de Google solo aparece cuando las credenciales están cargadas en
// Supabase. Sin esto, mostraríamos un botón que falla siempre.
const GOOGLE_ENABLED = process.env.NEXT_PUBLIC_ENABLE_GOOGLE_AUTH === "true";

/** Traduce los errores de Supabase a algo accionable, en español. */
function explain(raw: string, status?: number): string {
  const m = raw.toLowerCase();
  if (status === 429 || m.includes("rate limit") || m.includes("too many"))
    return "Demasiados intentos seguidos. Espera un minuto y vuelve a probar.";
  if (m.includes("invalid login credentials"))
    return "Email o contraseña incorrectos.";
  if (m.includes("already registered") || m.includes("already been registered"))
    return "Ya hay una cuenta con ese email. Inicia sesión.";
  if (m.includes("password should be at least"))
    return "La contraseña necesita al menos 6 caracteres.";
  if (m.includes("provider is not enabled") || m.includes("unsupported provider"))
    return "El acceso con Google todavía no está configurado.";
  if (m.includes("email address") && m.includes("invalid"))
    return "Ese email no parece válido.";
  return raw;
}

export default function LoginPage() {
  const router = useRouter();
  const supabase = createClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleEmail(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setNotice(null);

    const { data, error } =
      mode === "signin"
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password });

    if (error) {
      setLoading(false);
      return setError(explain(error.message, error.status));
    }

    // Con la confirmación por email desactivada, el registro ya devuelve
    // sesión y entramos directo. Si algún día se reactiva, avisamos.
    if (mode === "signup" && !data.session) {
      setLoading(false);
      return setNotice("Cuenta creada. Revisa tu email para confirmarla.");
    }

    router.push("/drive");
    router.refresh();
  }

  async function handleGoogle() {
    setError(null);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${location.origin}/auth/callback` },
    });
    if (error) setError(explain(error.message, error.status));
  }

  const signin = mode === "signin";

  return (
    <main className="grid min-h-dvh lg:grid-cols-[1.05fr_1fr]">
      {/* Cara grabada: la marca sobre el guilloche. */}
      <section className="relative hidden overflow-hidden bg-surface-2 lg:flex lg:flex-col lg:justify-between lg:p-14">
        <div className="absolute inset-0 flex items-center justify-center">
          <Guilloche className="max-w-[36rem] opacity-90" />
        </div>

        <div className="relative">
          <Wordmark />
        </div>

        <div className="relative max-w-sm">
          <h2 className="font-display text-2xl font-semibold">
            Firma que deja constancia.
          </h2>
          <p className="mt-3 text-sm text-muted">
            Cada documento firmado guarda su certificado, su huella SHA-256 y la
            hora exacta. Cualquiera con acceso puede comprobarlo después.
          </p>
        </div>
      </section>

      {/* Cara de formulario. */}
      <section className="flex flex-col justify-center px-6 py-14 sm:px-12">
        <div className="mx-auto w-full max-w-sm">
          <div className="lg:hidden">
            <Wordmark />
          </div>

          <h1 className="mt-10 font-display text-3xl font-semibold lg:mt-0">
            {signin ? "Entrar" : "Crear cuenta"}
          </h1>
          <p className="mt-2 text-sm text-muted">
            {signin
              ? "Accede para ver y firmar tus documentos."
              : "Se crea al instante, sin confirmar email."}
          </p>

          <form onSubmit={handleEmail} className="mt-8 flex flex-col gap-4">
            <Field
              id="email"
              label="Email"
              type="email"
              value={email}
              onChange={setEmail}
              autoComplete="email"
              placeholder="tu@email.com"
            />
            <Field
              id="password"
              label="Contraseña"
              type="password"
              value={password}
              onChange={setPassword}
              autoComplete={signin ? "current-password" : "new-password"}
              placeholder={signin ? "••••••••" : "Mínimo 6 caracteres"}
              minLength={6}
            />

            <button
              type="submit"
              disabled={loading}
              className="mt-1 inline-flex h-11 items-center justify-center gap-2 rounded bg-seal px-4 text-sm font-medium text-seal-ink transition-opacity hover:opacity-90 disabled:opacity-60"
            >
              {loading && <Spinner />}
              {loading ? "Un momento…" : signin ? "Entrar" : "Crear cuenta"}
            </button>
          </form>

          {GOOGLE_ENABLED && (
            <>
              <div className="my-6 flex items-center gap-4">
                <span className="h-px flex-1 bg-line" />
                <span className="text-micro uppercase text-muted">o</span>
                <span className="h-px flex-1 bg-line" />
              </div>
              <button
                onClick={handleGoogle}
                className="inline-flex h-11 w-full items-center justify-center gap-2 rounded border border-line-strong bg-surface px-4 text-sm font-medium transition-colors hover:bg-surface-2"
              >
                <GoogleGlyph /> Continuar con Google
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
          {notice && (
            <p className="mt-5 rounded border-l-2 border-ok bg-ok-soft px-3 py-2 text-sm text-ok">
              {notice}
            </p>
          )}

          <p className="mt-8 text-sm text-muted">
            {signin ? "¿Todavía no tienes cuenta?" : "¿Ya tienes cuenta?"}{" "}
            <button
              onClick={() => {
                setMode(signin ? "signup" : "signin");
                setError(null);
                setNotice(null);
              }}
              className="font-medium text-seal underline decoration-seal/30 underline-offset-4 hover:decoration-seal"
            >
              {signin ? "Créala aquí" : "Entra aquí"}
            </button>
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

function Field({
  id,
  label,
  type,
  value,
  onChange,
  placeholder,
  autoComplete,
  minLength,
}: {
  id: string;
  label: string;
  type: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoComplete?: string;
  minLength?: number;
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
        minLength={minLength}
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
