"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Spinner } from "@/components/spinner";
import {
  BadgeCheck,
  Download,
  PenLine,
  Plus,
  ShieldCheck,
  Trash2,
  Users,
} from "lucide-react";

type Field = {
  id: string;
  page: number;
  assigned_email: string | null;
};
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

  async function addField() {
    const email = window.prompt("Email del firmante para este campo");
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
      setError(data?.error ?? error?.message ?? "Error al firmar");
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
    <div className="space-y-6">
      {/* Estado */}
      <div>
        <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold">
          <PenLine className="h-4 w-4" /> Firma
        </h2>
        <StatusBadge status={status} />
      </div>

      {/* Campos de firma */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-medium text-muted-foreground">
            Campos de firma
          </h3>
          {isOwner && !signedPath && (
            <button
              onClick={addField}
              disabled={pending}
              className="inline-flex items-center gap-1 text-xs text-primary"
            >
              <Plus className="h-3 w-3" /> Añadir
            </button>
          )}
        </div>
        {fields.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {isOwner
              ? "Añade un campo y asigna un firmante por email."
              : "Sin campos definidos."}
          </p>
        ) : (
          <ul className="space-y-1">
            {fields.map((f) => (
              <li
                key={f.id}
                className="flex items-center justify-between rounded-lg border p-2 text-sm"
              >
                <span className="truncate">
                  Pág. {f.page} · {f.assigned_email ?? "sin asignar"}
                </span>
                {isOwner && !signedPath && (
                  <button
                    onClick={() => removeField(f.id)}
                    className="text-muted-foreground hover:text-red-600"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Acciones */}
      <div className="space-y-2">
        {!alreadySigned && (
          <button
            onClick={sign}
            disabled={signing}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
          >
            {signing ? <Spinner /> : <PenLine className="h-4 w-4" />}
            {signing ? "Firmando..." : "Firmar documento"}
          </button>
        )}
        {alreadySigned && (
          <p className="flex items-center gap-2 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">
            <BadgeCheck className="h-4 w-4" /> Ya firmaste este documento.
          </p>
        )}

        {signedPath && (
          <button
            onClick={downloadSigned}
            className="flex w-full items-center justify-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium"
          >
            <Download className="h-4 w-4" /> Descargar firmado
          </button>
        )}

        {signedPath && (
          <button
            onClick={runVerify}
            disabled={verifying}
            className="flex w-full items-center justify-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium disabled:opacity-60"
          >
            {verifying ? <Spinner /> : <ShieldCheck className="h-4 w-4" />}
            {verifying ? "Verificando..." : "Verificar firma"}
          </button>
        )}
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}

      {verify && <VerifyBox result={verify} />}

      {/* Firmantes */}
      <div>
        <h3 className="mb-2 flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <Users className="h-4 w-4" /> Firmantes ({signers.length})
        </h3>
        {signers.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nadie ha firmado aún.</p>
        ) : (
          <ul className="space-y-1">
            {signers.map((s, i) => (
              <li key={i} className="rounded-lg border p-2 text-xs">
                <div className="flex items-center gap-1 font-medium text-green-700">
                  <BadgeCheck className="h-3.5 w-3.5" /> Firmado
                </div>
                <div className="text-muted-foreground">
                  {new Date(s.signed_at).toLocaleString("es")}
                </div>
                {s.cert_subject && (
                  <div className="truncate text-muted-foreground">
                    {s.cert_subject}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    borrador: "bg-muted text-muted-foreground",
    en_firma: "bg-amber-100 text-amber-700",
    firmado: "bg-green-100 text-green-700",
    archivado: "bg-muted text-muted-foreground",
  };
  const label: Record<string, string> = {
    borrador: "Borrador",
    en_firma: "En firma",
    firmado: "Firmado",
    archivado: "Archivado",
  };
  return (
    <span
      className={`inline-block rounded-full px-2.5 py-1 text-xs font-medium ${map[status] ?? map.borrador}`}
    >
      {label[status] ?? status}
    </span>
  );
}

function VerifyBox({ result }: { result: VerifyResult }) {
  if (result.error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
        Error: {result.error}
      </div>
    );
  }
  return (
    <div
      className={`rounded-lg border p-3 text-sm ${
        result.valid
          ? "border-green-200 bg-green-50 text-green-800"
          : "border-amber-200 bg-amber-50 text-amber-800"
      }`}
    >
      <p className="mb-1 font-semibold">
        {result.valid ? "✓ Documento válido" : "⚠ Verificación con reparos"}
      </p>
      {result.reason && <p>{result.reason}</p>}
      <ul className="mt-1 space-y-0.5 text-xs">
        <li>Firma detectada: {result.hasSignature ? "sí" : "no"}</li>
        <li>Integridad (hash): {result.hashMatch ? "ok" : "no coincide"}</li>
        <li>Nº de firmas: {result.signatureCount ?? 0}</li>
      </ul>
      {result.note && (
        <p className="mt-2 text-xs text-muted-foreground">{result.note}</p>
      )}
    </div>
  );
}
