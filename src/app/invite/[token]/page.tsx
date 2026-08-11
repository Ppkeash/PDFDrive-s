import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/**
 * Resuelve el link único de invitación (ver `share-dialog.tsx` y la edge
 * function `accept-invite`): sin sesión, manda a loguearse y volver aquí
 * mismo; con sesión, pide el acceso y sigue directo al documento.
 */
export default async function InvitePage({
  params,
}: {
  params: { token: string };
}) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect(`/login?next=${encodeURIComponent(`/invite/${params.token}`)}`);

  const { data, error } = await supabase.functions.invoke("accept-invite", {
    body: { token: params.token },
  });

  if (error || data?.error) {
    return (
      <main className="flex min-h-dvh items-center justify-center p-6">
        <div className="max-w-sm rounded-lg border border-dashed border-line-strong bg-surface p-6 text-center">
          <h1 className="font-display text-lg font-semibold">
            Este link no funcionó
          </h1>
          <p className="mt-1.5 text-sm text-muted">
            {data?.error ?? "No se pudo validar la invitación."}
          </p>
          <Link
            href="/drive"
            className="mt-4 inline-flex h-10 items-center justify-center rounded border border-line-strong bg-surface px-4 text-sm font-medium transition-colors hover:bg-surface-2"
          >
            Ir a mis documentos
          </Link>
        </div>
      </main>
    );
  }

  redirect(`/doc/${data.documentId}`);
}
