"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Spinner } from "@/components/spinner";
import { StatusChip } from "@/components/status-chip";
import {
  BadgeCheck,
  Download,
  PenLine,
  Plus,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import type { DocStatus } from "@/types";

type Field = { id: string; page: number; assigned_email: string | null };
type Signer = {
  signer_id: string | null;
  signed_at: string;
  cert_subject: string | null;
};
type VerifyResult = {
  valid?: boolean;
  hasSignature?: boolean;
  hashMatch?: boolean;
  signatureCount?: number;
  note?: string;
  error?: string;
  reason?: string;
};

export function SignaturePanel({
  documentId,
  isOwner,
  status,
  signedPath,
  fields,
  signers,
  alreadySigned,
}: {
  documentId: string;
  isOwner: boolean;
  status: string;
  signedPath: string | null;
  fields: Field[];
  signers: Signer[];
  alreadySigned: boolean;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [pending, startTransition] = useTransition();
  const [signing, setSigning] = useState(false);
  const [verify, setVerify] = useState<VerifyResult | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function addField() {
    const email = window.prompt("Email de quien debe firmar este campo");
    if (!email) return;
    startTransition(async () => {
      const { error } = await supabase.from("signature_fields").insert({
        document_id: documentId,
        page: 1,
        x: 60,
        y: 120,
        w: 200,
        h: 40,
        assigned_email: email.trim(),
        order_index: fields.length,
      });
      if (error) setError(error.message);
      router.refresh();
    });
  }

  function removeField(id: string) {
    startTransition(async () => {
      await supabase.from("signature_fields").delete().eq("id", id);
      router.refresh();
    });
  }

  async function sign() {
    setError(null);
    setSigning(true);
    const { data, error } = await supabase.functions.invoke("sign-pdf", {
      body: { documentId },
    });
    setSigning(false);
    if (error || data?.error) {
      setError(data?.error ?? error?.message ?? "No se pudo firmar.");
      return;
    }
    router.refresh();
  }

  async function runVerify() {
    setVerifying(true);
    setVerify(null);
    const { data, error } = await supabase.functions.invoke("verify-pdf", {
      body: { documentId },
    });
    setVerifying(false);
    setVerify(data ?? { error: error?.message });
  }

  async function downloadSigned() {
    if (!signedPath) return;
    const { data } = await supabase.storage
      .from("signed")
      .createSignedUrl(signedPath, 60);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank");
  }

  return (
    <div className="flex flex-col gap-7">
      <header className="flex items-center justify-between gap-3">
        <SectionLabel>Estado</SectionLabel>
        <StatusChip status={status as DocStatus} />
      </header>

      {/* Campos de firma */}
      <section className="flex flex-col gap-2.5">
        <div className="flex items-center justify-between gap-3">
          <SectionLabel>Campos de firma</SectionLabel>
          {isOwner && !signedPath && (
            <button
              onClick={addField}
              disabled={pending}
              className="inline-flex items-center gap-1 text-xs font-medium text-seal transition-opacity hover:opacity-80 disabled:opacity-50"
            >
              <Plus className="h-3.5 w-3.5" /> Añadir
            </button>
          )}
        </div>

        {fields.length === 0 ? (
          <p className="text-sm text-muted">
            {isOwner
              ? "Sin campos. Añade uno y asigna quién debe firmarlo."
              : "Sin campos definidos."}
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {fields.map((f) => (
              <li
                key={f.id}
                className="flex items-center justify-between gap-2 rounded border border-line bg-surface-2 px-3 py-2"
              >
                <span className="min-w-0 flex-1 truncate text-sm">
                  <span className="tnum font-mono text-xs text-muted">
                    p.{f.page}
                  </span>{" "}
                  {f.assigned_email ?? "sin asignar"}
                </span>
                {isOwner && !signedPath && (
                  <button
                    onClick={() => removeField(f.id)}
                    aria-label="Quitar campo"
                    className="shrink-0 rounded p-1 text-muted transition-colors hover:text-danger"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Acciones */}
      <section className="flex flex-col gap-2">
        {alreadySigned ? (
          <p className="flex items-center gap-2 rounded border border-ok/25 bg-ok-soft px-3 py-2.5 text-sm font-medium text-ok">
            <BadgeCheck className="h-4 w-4 shrink-0" /> Ya firmaste este
            documento.
          </p>
        ) : (
          <button
            onClick={sign}
            disabled={signing}
            className="inline-flex h-11 items-center justify-center gap-2 rounded bg-seal px-4 text-sm font-medium text-seal-ink transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {signing ? <Spinner /> : <PenLine className="h-4 w-4" />}
            {signing ? "Firmando…" : "Firmar documento"}
          </button>
        )}

        {signedPath && (
          <>
            <button
              onClick={downloadSigned}
              className="inline-flex h-11 items-center justify-center gap-2 rounded border border-line-strong bg-surface px-4 text-sm font-medium transition-colors hover:bg-surface-2"
            >
              <Download className="h-4 w-4" /> Descargar firmado
            </button>
            <button
              onClick={runVerify}
              disabled={verifying}
              className="inline-flex h-11 items-center justify-center gap-2 rounded border border-line-strong bg-surface px-4 text-sm font-medium transition-colors hover:bg-surface-2 disabled:opacity-60"
            >
              {verifying ? <Spinner /> : <ShieldCheck className="h-4 w-4" />}
              {verifying ? "Verificando…" : "Verificar firma"}
            </button>
          </>
        )}

        {error && (
          <p
            role="alert"
            className="rounded border-l-2 border-danger bg-surface-2 px-3 py-2 text-sm text-danger"
          >
            {error}
          </p>
        )}
      </section>

      {verify && <VerifyBox result={verify} />}

      {/* Firmantes: el acta propiamente dicha. */}
      <section className="flex flex-col gap-2.5">
        <SectionLabel>Firmantes ({signers.length})</SectionLabel>
        {signers.length === 0 ? (
          <p className="text-sm text-muted">Nadie ha firmado todavía.</p>
        ) : (
          <ol className="flex flex-col gap-2">
            {signers.map((s, i) => (
              <li
                key={i}
                className="rounded border border-line bg-surface-2 p-3"
              >
                <div className="flex items-center gap-1.5 text-sm font-medium text-ok">
                  <BadgeCheck className="h-4 w-4 shrink-0" /> Firmado
                </div>
                <dl className="mt-2 flex flex-col gap-1">
                  <Row term="Fecha">
                    {new Date(s.signed_at).toLocaleString("es", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </Row>
                  {s.cert_subject && (
                    <Row term="Certificado">{s.cert_subject}</Row>
                  )}
                </dl>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <h2 className="text-micro uppercase text-muted">{children}</h2>;
}

/** Par dato/valor del acta: el valor siempre en mono. */
function Row({
  term,
  children,
}: {
  term: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-2 text-xs">
      <dt className="w-20 shrink-0 text-muted">{term}</dt>
      <dd className="tnum min-w-0 flex-1 break-all font-mono text-ink">
        {children}
      </dd>
    </div>
  );
}

function VerifyBox({ result }: { result: VerifyResult }) {
  if (result.error) {
    return (
      <p
        role="alert"
        className="rounded border-l-2 border-danger bg-surface-2 px-3 py-2 text-sm text-danger"
      >
        {result.error}
      </p>
    );
  }

  const valid = result.valid;
  return (
    <section
      className={`rounded border p-3.5 ${
        valid
          ? "border-ok/25 bg-ok-soft"
          : "border-wait/30 bg-wait-soft"
      }`}
    >
      <p
        className={`flex items-center gap-2 text-sm font-semibold ${
          valid ? "text-ok" : "text-wait"
        }`}
      >
        <ShieldCheck className="h-4 w-4 shrink-0" />
        {valid ? "Documento válido" : "Verificación con reparos"}
      </p>

      {result.reason && (
        <p className="mt-1.5 text-sm text-muted">{result.reason}</p>
      )}

      <dl className="mt-3 flex flex-col gap-1">
        <Check label="Firma detectada" ok={!!result.hasSignature} />
        <Check label="Integridad (hash)" ok={!!result.hashMatch} />
        <div className="flex items-center justify-between gap-2 text-xs">
          <dt className="text-muted">Nº de firmas</dt>
          <dd className="tnum font-mono">{result.signatureCount ?? 0}</dd>
        </div>
      </dl>

      {result.note && (
        <p className="mt-3 border-t border-line pt-2.5 text-xs text-muted">
          {result.note}
        </p>
      )}
    </section>
  );
}

function Check({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2 text-xs">
      <dt className="text-muted">{label}</dt>
      <dd className={`font-mono font-medium ${ok ? "text-ok" : "text-danger"}`}>
        {ok ? "sí" : "no"}
      </dd>
    </div>
  );
}
