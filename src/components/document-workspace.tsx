"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { RubricPad } from "@/components/rubric-pad";
import { StatusChip } from "@/components/status-chip";
import { ShareDialog } from "@/components/share-dialog";
import { Spinner } from "@/components/spinner";
import { DEFAULT_FIELD, type SignField } from "@/components/pdf-viewer";
import { cn } from "@/lib/utils";
import type { DocStatus } from "@/types";
import {
  BadgeCheck,
  Check,
  MapPin,
  PenLine,
  ShieldCheck,
  Users,
} from "lucide-react";

// pdf.js toca APIs del navegador: fuera del render del servidor.
const PdfViewer = dynamic(
  () => import("@/components/pdf-viewer").then((m) => m.PdfViewer),
  {
    ssr: false,
    loading: () => (
      <div className="flex min-h-[50vh] items-center justify-center gap-2 text-muted">
        <Spinner className="h-5 w-5 text-seal" />
        <span className="text-sm">Cargando visor…</span>
      </div>
    ),
  }
);

type Signer = {
  signer_id: string | null;
  field_id: string | null;
  signed_at: string;
  cert_subject: string | null;
};

type VerifySignature = {
  valid: boolean;
  digestMatch: boolean;
  signatureValid: boolean;
  coversWholeFile: boolean;
  subject: string | null;
  signedAt: string | null;
  problem?: string;
};

type VerifyResult = {
  state?: string;
  valid?: boolean;
  reason?: string;
  signatures?: VerifySignature[];
  caveat?: string | null;
  error?: string;
};

export function DocumentWorkspace({
  documentId,
  url,
  isOwner,
  status,
  sealed,
  fields,
  signers,
  shares,
  userEmail,
}: {
  documentId: string;
  url: string | null;
  isOwner: boolean;
  status: DocStatus;
  sealed: boolean;
  fields: SignField[];
  signers: Signer[];
  shares: { email: string; role: string }[];
  userEmail: string;
}) {
  const router = useRouter();
  const supabase = createClient();

  const [placing, setPlacing] = useState(false);
  const [assignTo, setAssignTo] = useState(userEmail);
  const [padOpen, setPadOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verify, setVerify] = useState<VerifyResult | null>(null);
  const [verifying, setVerifying] = useState(false);

  // El campo que le toca a esta persona: lo suyo, pendiente.
  const myField = useMemo(
    () =>
      fields.find(
        (f) =>
          !f.signed &&
          f.assigned_email?.trim().toLowerCase() === userEmail.toLowerCase()
      ) ?? null,
    [fields, userEmail]
  );

  const unassignedPending = useMemo(
    () => fields.find((f) => !f.signed && !f.assigned_email) ?? null,
    [fields]
  );

  const pendingCount = fields.filter((f) => !f.signed).length;
  const noFields = fields.length === 0;

  // Puedo firmar si tengo campo propio pendiente, o si soy el dueño y hay un
  // campo sin asignar, o si el documento no tiene campos y soy el dueño.
  const signableField = myField ?? (isOwner ? unassignedPending : null);
  const canSign =
    !sealed && (signableField !== null || (noFields && isOwner));

  const candidates = useMemo(() => {
    const set = new Set<string>([userEmail, ...shares.map((s) => s.email)]);
    return [...set];
  }, [shares, userEmail]);

  async function addField(page: number, x: number, y: number) {
    setError(null);
    const email = assignTo.trim();
    if (!email) return setError("Elige a quién le toca firmar este campo.");

    const { error } = await supabase.from("signature_fields").insert({
      document_id: documentId,
      page,
      x,
      y,
      w: DEFAULT_FIELD.w,
      h: DEFAULT_FIELD.h,
      assigned_email: email,
      order_index: fields.length,
    });
    if (error) return setError(error.message);
    router.refresh();
  }

  async function removeField(id: string) {
    const { error } = await supabase
      .from("signature_fields")
      .delete()
      .eq("id", id);
    if (error) return setError(error.message);
    router.refresh();
  }

  async function submitRubric(png: string) {
    setBusy(true);
    setError(null);
    const { data, error } = await supabase.functions.invoke("sign-pdf", {
      body: {
        documentId,
        fieldId: signableField?.id ?? null,
        rubric: png,
      },
    });
    setBusy(false);

    if (error || data?.error) {
      setError(data?.error ?? error?.message ?? "No se pudo firmar.");
      return;
    }
    setPadOpen(false);
    setVerify(null);
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

  return (
    <div className="flex flex-1 flex-col lg:flex-row">
      {/* Visor */}
      <div className="min-w-0 flex-1 bg-paper p-4 sm:p-5">
        {placing && (
          <p className="mb-3 flex items-center gap-2 rounded border-l-2 border-seal bg-seal-soft px-3 py-2 text-sm text-seal">
            <MapPin className="h-4 w-4 shrink-0" />
            Haz clic en el punto exacto donde debe firmar{" "}
            <strong className="font-medium">{assignTo}</strong>.
          </p>
        )}
        {url ? (
          <PdfViewer
            url={url}
            fields={fields}
            placing={placing && isOwner && !sealed}
            onPlace={addField}
            onRemove={isOwner && !sealed ? removeField : undefined}
            highlightEmail={userEmail}
          />
        ) : (
          <div className="flex min-h-[50vh] items-center justify-center rounded-lg border border-dashed border-line-strong bg-surface text-sm text-muted">
            No se pudo cargar el documento.
          </div>
        )}
      </div>

      {/* Acta lateral */}
      <aside className="w-full shrink-0 border-t border-line bg-surface p-5 lg:w-[22rem] lg:border-l lg:border-t-0">
        <div className="flex flex-col gap-7">
          <header className="flex items-center justify-between gap-3">
            <h2 className="text-micro uppercase text-muted">Estado</h2>
            <StatusChip status={status} />
          </header>

          {/* Progreso: lo primero que hay que saber. */}
          {!sealed && (
            <p className="text-sm text-muted">
              {noFields
                ? "Sin campos de firma. Colócalos sobre el documento, o firma tú directamente."
                : pendingCount === 0
                  ? "Todos los campos están firmados."
                  : `Faltan ${pendingCount} de ${fields.length} firmas.`}
            </p>
          )}
          {sealed && (
            <p className="flex items-start gap-2 rounded border border-ok/25 bg-ok-soft px-3 py-2.5 text-sm text-ok">
              <BadgeCheck className="mt-0.5 h-4 w-4 shrink-0" />
              Documento cerrado y sellado. Cualquier cambio posterior rompería
              la firma.
            </p>
          )}

          {/* Colocar campos */}
          {isOwner && !sealed && (
            <section className="flex flex-col gap-2.5">
              <h2 className="text-micro uppercase text-muted">
                Campos de firma
              </h2>

              {placing && (
                <label className="flex flex-col gap-1.5">
                  <span className="text-xs text-muted">¿Quién firma aquí?</span>
                  <input
                    list="firmantes"
                    value={assignTo}
                    onChange={(e) => setAssignTo(e.target.value)}
                    placeholder="email@persona.com"
                    className="h-10 rounded border border-line-strong bg-surface px-3 text-sm outline-none focus:border-seal"
                  />
                  <datalist id="firmantes">
                    {candidates.map((c) => (
                      <option key={c} value={c} />
                    ))}
                  </datalist>
                </label>
              )}

              <button
                onClick={() => setPlacing((v) => !v)}
                className={cn(
                  "inline-flex h-10 items-center justify-center gap-2 rounded border px-3.5 text-sm font-medium transition-colors",
                  placing
                    ? "border-seal bg-seal text-seal-ink"
                    : "border-line-strong bg-surface hover:bg-surface-2"
                )}
              >
                {placing ? (
                  <>
                    <Check className="h-4 w-4" /> Terminar de colocar
                  </>
                ) : (
                  <>
                    <MapPin className="h-4 w-4" /> Colocar campo
                  </>
                )}
              </button>
            </section>
          )}

          {/* Lista de campos */}
          {fields.length > 0 && (
            <section className="flex flex-col gap-2">
              <h2 className="text-micro uppercase text-muted">
                Firmantes asignados
              </h2>
              <ul className="flex flex-col gap-1">
                {fields.map((f) => (
                  <li
                    key={f.id}
                    className="flex items-center gap-2 rounded border border-line bg-surface-2 px-3 py-2 text-sm"
                  >
                    <span
                      className={cn(
                        "h-1.5 w-1.5 shrink-0 rounded-full",
                        f.signed ? "bg-ok" : "bg-wait"
                      )}
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1 truncate">
                      {f.assigned_email ?? "Sin asignar"}
                    </span>
                    <span className="tnum shrink-0 font-mono text-xs text-muted">
                      p.{f.page}
                    </span>
                    <span
                      className={cn(
                        "shrink-0 text-xs font-medium",
                        f.signed ? "text-ok" : "text-wait"
                      )}
                    >
                      {f.signed ? "Firmado" : "Pendiente"}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Acciones */}
          <section className="flex flex-col gap-2">
            {canSign && (
              <button
                onClick={() => setPadOpen(true)}
                className="inline-flex h-11 items-center justify-center gap-2 rounded bg-seal px-4 text-sm font-medium text-seal-ink transition-opacity hover:opacity-90"
              >
                <PenLine className="h-4 w-4" /> Firmar
              </button>
            )}

            {!canSign && !sealed && (
              <p className="text-sm text-muted">
                {fields.some(
                  (f) =>
                    f.signed &&
                    f.assigned_email?.toLowerCase() === userEmail.toLowerCase()
                )
                  ? "Ya firmaste. Falta que firmen los demás."
                  : "No tienes ningún campo pendiente en este documento."}
              </p>
            )}

            {sealed && (
              <button
                onClick={runVerify}
                disabled={verifying}
                className="inline-flex h-11 items-center justify-center gap-2 rounded border border-line-strong bg-surface px-4 text-sm font-medium transition-colors hover:bg-surface-2 disabled:opacity-60"
              >
                {verifying ? <Spinner /> : <ShieldCheck className="h-4 w-4" />}
                {verifying ? "Verificando…" : "Verificar firma"}
              </button>
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

          {/* Firmas registradas */}
          {signers.length > 0 && (
            <section className="flex flex-col gap-2.5">
              <h2 className="text-micro uppercase text-muted">
                Firmas registradas ({signers.length})
              </h2>
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
            </section>
          )}

          {/* Accesos */}
          <section className="border-t border-line pt-5">
            <div className="flex items-center justify-between gap-3">
              <h2 className="flex items-center gap-2 text-micro uppercase text-muted">
                <Users className="h-3.5 w-3.5" /> Con acceso ({shares.length})
              </h2>
              {isOwner && <ShareDialog documentId={documentId} compact />}
            </div>
            {shares.length === 0 ? (
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
        </div>
      </aside>

      <RubricPad
        open={padOpen}
        busy={busy}
        onCancel={() => !busy && setPadOpen(false)}
        onConfirm={submitRubric}
        title={
          signableField?.assigned_email
            ? `Firma de ${signableField.assigned_email}`
            : "Dibuja tu firma"
        }
      />
    </div>
  );
}

function Row({ term, children }: { term: string; children: React.ReactNode }) {
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
  const sig = result.signatures?.[0];

  return (
    <section
      className={cn(
        "rounded border p-3.5",
        valid ? "border-ok/25 bg-ok-soft" : "border-wait/30 bg-wait-soft"
      )}
    >
      <p
        className={cn(
          "flex items-center gap-2 text-sm font-semibold",
          valid ? "text-ok" : "text-wait"
        )}
      >
        <ShieldCheck className="h-4 w-4 shrink-0" />
        {valid ? "Firma válida" : "La verificación no pasó"}
      </p>

      {result.reason && (
        <p className="mt-1.5 text-sm text-muted">{result.reason}</p>
      )}

      {sig && (
        <dl className="mt-3 flex flex-col gap-1">
          <Check2 label="El documento no se modificó" ok={sig.digestMatch} />
          <Check2 label="Firma del certificado" ok={sig.signatureValid} />
          <Check2 label="Cubre el archivo entero" ok={sig.coversWholeFile} />
        </dl>
      )}

      {sig?.subject && (
        <p className="mt-3 break-all border-t border-line pt-2.5 font-mono text-xs text-muted">
          {sig.subject}
        </p>
      )}

      {sig?.problem && (
        <p className="mt-2 text-xs text-danger">{sig.problem}</p>
      )}

      {result.caveat && (
        <p className="mt-3 border-t border-line pt-2.5 text-xs text-muted">
          {result.caveat}
        </p>
      )}
    </section>
  );
}

function Check2({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2 text-xs">
      <dt className="text-muted">{label}</dt>
      <dd className={cn("font-mono font-medium", ok ? "text-ok" : "text-danger")}>
        {ok ? "sí" : "no"}
      </dd>
    </div>
  );
}
