import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ShareDialog, type ShareRow } from "@/components/share-dialog";
import { DocumentWorkspace } from "@/components/document-workspace";
import type { SignField } from "@/components/pdf-viewer";
import type { DocStatus, ShareRole } from "@/types";
import { ArrowLeft, Download } from "lucide-react";

export default async function DocumentPage({
  params,
}: {
  params: { id: string };
}) {
  const supabase = createClient();

  const { data: doc } = await supabase
    .from("documents")
    .select(
      "id, name, mime, status, owner_id, storage_path, signed_path, current_hash"
    )
    .eq("id", params.id)
    .maybeSingle();

  if (!doc) notFound();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const isOwner = user?.id === doc.owner_id;

  // Se muestra siempre la última versión: con rúbricas si ya hay alguna.
  const viewBucket = doc.signed_path ? "signed" : "originals";
  const viewPath = doc.signed_path ?? doc.storage_path;
  const { data: signedUrl } = await supabase.storage
    .from(viewBucket)
    .createSignedUrl(viewPath, 3600);

  const [
    { data: shareRows },
    { data: fieldRows },
    { data: signatureRows },
    { data: ownerProfile },
  ] = await Promise.all([
      supabase
        .from("document_shares")
        .select("email, role, user_id")
        .eq("document_id", doc.id),
      supabase
        .from("signature_fields")
        .select("id, page, x, y, w, h, assigned_email")
        .eq("document_id", doc.id)
        .order("order_index"),
      supabase
        .from("signatures")
        .select("signer_id, field_id, signed_at, cert_subject")
        .eq("document_id", doc.id)
        .order("signed_at"),
      supabase
        .from("profiles")
        .select("email")
        .eq("id", doc.owner_id)
        .maybeSingle(),
    ]);

  // `pending` = invitado sin cuenta todavía; el trigger link_pending_shares la
  // enlazará cuando se registre con ese mismo correo.
  const shares: ShareRow[] = (shareRows ?? []).map((s) => ({
    email: s.email,
    role: s.role,
    pending: !s.user_id,
  }));

  const myEmail = user?.email?.toLowerCase() ?? "";
  const role: ShareRole = isOwner
    ? "propietario"
    : ((shares.find((s) => s.email.toLowerCase() === myEmail)
        ?.role as ShareRole) ?? "lector");

  const signatures = signatureRows ?? [];
  const signedFieldIds = new Set(
    signatures.map((s) => s.field_id).filter(Boolean)
  );

  const fields: SignField[] = (fieldRows ?? []).map((f) => ({
    id: f.id,
    page: f.page,
    x: f.x,
    y: f.y,
    w: f.w,
    h: f.h,
    assigned_email: f.assigned_email,
    signed: signedFieldIds.has(f.id),
  }));

  const isPdf = doc.mime === "application/pdf";
  const sealed = doc.status === "firmado";

  return (
    <div className="flex min-h-dvh flex-col">
      {/* Fija arriba: si se va con el scroll, tapa "Volver" y "Compartir" en
          cuanto el documento tiene varias páginas. z-40 por encima del aside
          (z-30), que ahora empieza justo debajo de esta barra. */}
      <header className="sticky top-0 z-40 flex shrink-0 items-center justify-between gap-3 border-b border-line bg-surface px-4 py-3 sm:px-5">
        <div className="flex min-w-0 items-center gap-3">
          <Link
            href="/drive"
            aria-label="Volver a mis documentos"
            className="shrink-0 rounded p-1.5 text-muted transition-colors hover:bg-surface-2 hover:text-ink"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div className="min-w-0">
            <h1 className="truncate font-display text-lg font-semibold">
              {doc.name}
            </h1>
            {doc.current_hash && (
              <p
                className="tnum truncate font-mono text-xs text-muted"
                title={doc.current_hash}
              >
                SHA-256 {doc.current_hash.slice(0, 16)}…
              </p>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {signedUrl?.signedUrl && (
            <a
              href={signedUrl.signedUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-10 items-center gap-2 rounded border border-line-strong bg-surface px-3.5 text-sm font-medium transition-colors hover:bg-surface-2"
            >
              <Download className="h-4 w-4" />
              <span className="hidden sm:inline">Descargar</span>
            </a>
          )}
          {isOwner && (
            <ShareDialog
              documentId={doc.id}
              shares={shares}
              ownerEmail={ownerProfile?.email ?? user?.email ?? ""}
            />
          )}
        </div>
      </header>

      {isPdf ? (
        <DocumentWorkspace
          documentId={doc.id}
          url={signedUrl?.signedUrl ?? null}
          isOwner={isOwner}
          role={role}
          status={doc.status as DocStatus}
          sealed={sealed}
          fields={fields}
          signers={signatures}
          shares={shares}
          ownerEmail={ownerProfile?.email ?? ""}
          userEmail={user?.email ?? ""}
        />
      ) : (
        <div className="flex flex-1 items-center justify-center p-6">
          <div className="max-w-sm rounded-lg border border-dashed border-line-strong bg-surface p-6 text-center">
            <h2 className="font-display text-lg font-semibold">
              Sin vista previa
            </h2>
            <p className="mt-1.5 text-sm text-muted">
              La firma digital aplica a PDF. Los .docx se podrán previsualizar
              cuando se active la conversión.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
