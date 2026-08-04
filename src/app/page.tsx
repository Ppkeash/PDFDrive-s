import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { FileSignature, Share2, Zap } from "lucide-react";

export default async function Home() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) redirect("/drive");

  return (
    <main className="mx-auto flex min-h-dvh max-w-5xl flex-col items-center justify-center gap-10 px-6 py-16 text-center">
      <div className="space-y-4">
        <div className="inline-flex items-center gap-2 rounded-full border px-4 py-1 text-sm text-muted-foreground">
          <FileSignature className="h-4 w-4" /> FirmaDrive
        </div>
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
          Firma documentos, juntos y en tiempo real
        </h1>
        <p className="mx-auto max-w-2xl text-lg text-muted-foreground">
          Sube PDF y documentos Office, compártelos como en un Drive y fírmalos
          con validez digital. Pensado para actas, acuerdos y notarías.
        </p>
      </div>

      <div className="grid w-full gap-4 sm:grid-cols-3">
        <Feature icon={<Share2 />} title="Compartido">
          Comparte por email con roles: firmante, editor o lector.
        </Feature>
        <Feature icon={<FileSignature />} title="Firma certificada">
          Firma digital X.509 con sello de tiempo y auditoría.
        </Feature>
        <Feature icon={<Zap />} title="Tiempo real">
          Colabora en vivo: presencia, campos y comentarios.
        </Feature>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        <Link
          href="/login"
          className="rounded-lg bg-primary px-6 py-3 font-medium text-primary-foreground"
        >
          Entrar
        </Link>
        <Link
          href="/verify"
          className="rounded-lg border px-6 py-3 font-medium"
        >
          Verificar un documento
        </Link>
      </div>
    </main>
  );
}

function Feature({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border p-5 text-left">
      <div className="mb-3 inline-flex h-9 w-9 items-center justify-center rounded-lg bg-muted text-primary [&>svg]:h-5 [&>svg]:w-5">
        {icon}
      </div>
      <h3 className="mb-1 font-semibold">{title}</h3>
      <p className="text-sm text-muted-foreground">{children}</p>
    </div>
  );
}
