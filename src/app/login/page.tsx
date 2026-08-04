"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { FileSignature } from "lucide-react";
import { Spinner } from "@/components/spinner";

export default function LoginPage() {
  const router = useRouter();
  const supabase = createClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleEmail(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMsg(null);
    const { data, error } =
      mode === "signin"
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password });

    if (error) {
      setLoading(false);
      return setMsg(error.message);
    }

    // Con confirmación de email desactivada (por defecto en local), signUp ya
    // devuelve sesión → entramos directo. Si no hay sesión, hace falta confirmar.
    if (mode === "signup" && !data.session) {
      setLoading(false);
      return setMsg("Cuenta creada. Revisa tu email para confirmarla.");
    }

    // Éxito: NO reseteamos loading; el spinner sigue hasta que /drive cargue.
    router.push("/drive");
    router.refresh();
  }

  async function handleGoogle() {
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${location.origin}/auth/callback` },
    });
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-6 py-12">
      <div className="flex items-center gap-2 text-lg font-semibold">
        <FileSignature className="h-5 w-5 text-primary" /> FirmaDrive
      </div>

      <div className="rounded-xl border p-6">
        <h1 className="mb-1 text-xl font-semibold">
          {mode === "signin" ? "Iniciar sesión" : "Crear cuenta"}
        </h1>
        <p className="mb-5 text-sm text-muted-foreground">
          Accede para gestionar y firmar tus documentos.
        </p>

        <form onSubmit={handleEmail} className="space-y-3">
          <input
            type="email"
            required
            placeholder="tu@email.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg border bg-transparent px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
          />
          <input
            type="password"
            required
            minLength={6}
            placeholder="Contraseña"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-lg border bg-transparent px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
          />
          <button
            type="submit"
            disabled={loading}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
          >
            {loading && <Spinner />}
            {loading
              ? "Entrando..."
              : mode === "signin"
                ? "Entrar"
                : "Registrarme"}
          </button>
        </form>

        <button
          onClick={handleGoogle}
          className="mt-3 w-full rounded-lg border px-4 py-2 text-sm font-medium"
        >
          Continuar con Google
        </button>

        {msg && <p className="mt-4 text-sm text-muted-foreground">{msg}</p>}

        <button
          onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
          className="mt-5 text-sm text-primary underline-offset-4 hover:underline"
        >
          {mode === "signin"
            ? "¿No tienes cuenta? Regístrate"
            : "¿Ya tienes cuenta? Inicia sesión"}
        </button>
      </div>
    </main>
  );
}
