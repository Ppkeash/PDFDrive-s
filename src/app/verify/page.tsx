import Link from "next/link";
import { ShieldCheck } from "lucide-react";

export default function VerifyPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-6 py-12">
      <Link href="/" className="text-sm text-muted-foreground">
        ← Inicio
      </Link>
      <div className="rounded-xl border p-6 text-center">
        <ShieldCheck className="mx-auto mb-3 h-8 w-8 text-primary" />
        <h1 className="text-xl font-semibold">Verificar documento</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Sube un PDF firmado para comprobar su integridad y firmantes. (Se
          activa en la Fase 2.)
        </p>
        <button
          disabled
          className="mt-5 w-full rounded-lg border px-4 py-2 text-sm font-medium opacity-60"
        >
          Seleccionar PDF
        </button>
      </div>
    </main>
  );
}
