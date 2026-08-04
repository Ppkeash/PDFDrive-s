import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ShareDialog } from "@/components/share-dialog";
import { SignaturePanel } from "@/components/signature-panel";
import { ArrowLeft, Download, FileText, Users } from "lucide-react";

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
      <header className="flex items-center justify-between gap-3 border-b p-4">
        <div className="flex min-w-0 items-center gap-3">
          <Link href="/drive" className="text-muted-foreground">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <FileText className="h-5 w-5 shrink-0 text-muted-foreground" />
          <h1 className="truncate font-semibold">{doc.name}</h1>
        </div>
        <div className="flex shrink-0 gap-2">
          {signed?.signedUrl && (
            <a
              href={signed.signedUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium"
            >
              <Download className="h-4 w-4" /> Descargar
            </a>
          )}
          {isOwner && <ShareDialog documentId={doc.id} />}
        </div>
      </header>

      <div className="flex flex-1 flex-col lg:flex-row">
        {/* Visor */}
        <div className="flex-1 bg-muted/40 p-4">
          {isPdf && signed?.signedUrl ? (
            <iframe
              src={signed.signedUrl}
              className="h-[70vh] w-full rounded-lg border bg-white lg:h-full"
              title={doc.name}
            />
          ) : (
            <div className="flex h-full min-h-[50vh] flex-col items-center justify-center rounded-lg border border-dashed text-center">
              <FileText className="mb-3 h-8 w-8 text-muted-foreground" />
              <p className="font-medium">Vista previa no disponible</p>
              <p className="mt-1 max-w-xs text-sm text-muted-foreground">
                Los .docx se previsualizarán tras la conversión a PDF (Fase 4).
                Usa “Descargar”.
              </p>
            </div>
          )}
        </div>

        {/* Panel lateral */}
        <aside className="w-full shrink-0 border-t p-4 lg:w-80 lg:border-l lg:border-t-0">
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
            <p className="text-sm text-muted-foreground">
              La firma digital aplica a PDF. Convierte el .docx (Fase 4).
            </p>
          )}

          {/* Accesos */}
          <div className="mt-6 border-t pt-4">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <Users className="h-4 w-4" /> Accesos
            </h2>
            {!shares || shares.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Aún no has compartido este documento.
              </p>
            ) : (
              <ul className="space-y-2">
                {shares.map((s) => (
                  <li
                    key={s.email}
                    className="flex items-center justify-between rounded-lg border p-2 text-sm"
                  >
                    <span className="truncate">{s.email}</span>
                    <span className="ml-2 shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs capitalize text-muted-foreground">
                      {s.role}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
