import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ShareDialog } from "@/components/share-dialog";
import { SignaturePanel } from "@/components/signature-panel";
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

  // Preferir la versión firmada para la vista previa.
  const viewBucket = doc.signed_path ? "signed" : "originals";
  const viewPath = doc.signed_path ?? doc.storage_path;
  const { data: signed } = await supabase.storage
    .from(viewBucket)
    .createSignedUrl(viewPath, 3600);

  const [{ data: shares }, { data: fields }, { data: signers }] =
    await Promise.all([
      supabase
        .from("document_shares")
        .select("email, role")
        .eq("document_id", doc.id),
      supabase
        .from("signature_fields")
        .select("id, page, assigned_email")
        .eq("document_id", doc.id)
        .order("order_index"),
      supabase
        .from("signatures")
        .select("signer_id, signed_at, cert_subject")
        .eq("document_id", doc.id)
        .order("signed_at"),
    ]);

  const isPdf = doc.mime === "application/pdf";
  const alreadySigned = !!signers?.some((s) => s.signer_id === user?.id);

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex items-center justify-between gap-3 border-b border-line bg-surface px-4 py-3 sm:px-5">
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
          {signed?.signedUrl && (
            <a
              href={signed.signedUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-10 items-center gap-2 rounded border border-line-strong bg-surface px-3.5 text-sm font-medium transition-colors hover:bg-surface-2"
            >
              <Download className="h-4 w-4" />
              <span className="hidden sm:inline">Descargar</span>
            </a>
          )}
          {isOwner && <ShareDialog documentId={doc.id} />}
        </div>
      </header>

      <div className="flex flex-1 flex-col lg:flex-row">
        {/* Visor */}
        <div className="flex-1 bg-paper p-4 sm:p-5">
          {isPdf && signed?.signedUrl ? (
            <iframe
              src={signed.signedUrl}
              className="h-[70vh] w-full rounded-lg border border-line bg-white lg:h-full"
              title={`Vista previa de ${doc.name}`}
            />
          ) : (
            <div className="flex h-full min-h-[50vh] flex-col items-center justify-center rounded-lg border border-dashed border-line-strong bg-surface p-6 text-center">
              <h2 className="font-display text-lg font-semibold">
                Sin vista previa
              </h2>
              <p className="mt-1.5 max-w-xs text-sm text-muted">
                Los .docx se podrán previsualizar cuando se active la conversión
                a PDF. Mientras tanto, descárgalo.
              </p>
            </div>
          )}
        </div>

        {/* Acta lateral */}
        <aside className="w-full shrink-0 border-t border-line bg-surface p-5 lg:w-[21rem] lg:border-l lg:border-t-0">
          {isPdf ? (
            <SignaturePanel
              documentId={doc.id}
              isOwner={isOwner}
              status={doc.status}
              signedPath={doc.signed_path}
              fields={fields ?? []}
              signers={signers ?? []}
              alreadySigned={alreadySigned}
            />
          ) : (
            <p className="text-sm text-muted">
              La firma digital solo aplica a PDF.
            </p>
          )}

          <section className="mt-7 border-t border-line pt-5">
            <h2 className="text-micro uppercase text-muted">
              Con acceso ({shares?.length ?? 0})
            </h2>
            {!shares || shares.length === 0 ? (
              <p className="mt-2.5 text-sm text-muted">
                Solo tú puedes ver este documento.
              </p>
            ) : (
              <ul className="mt-2.5 flex flex-col gap-1">
                {shares.map((s) => (
                  <li
                    key={s.email}
                    className="flex items-center justify-between gap-2 rounded border border-line bg-surface-2 px-3 py-2"
                  >
                    <span className="min-w-0 truncate text-sm">{s.email}</span>
                    <span className="shrink-0 text-xs capitalize text-muted">
                      {s.role}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
