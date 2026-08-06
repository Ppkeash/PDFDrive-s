"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { RubricPad } from "@/components/rubric-pad";
import { StatusChip } from "@/components/status-chip";
import { ShareDialog, type ShareRow } from "@/components/share-dialog";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Spinner } from "@/components/spinner";
import {
  DEFAULT_FIELD,
  type FieldBox,
  type GhostField,
  type PendingSignature,
  type SignField,
} from "@/components/pdf-viewer";
import { cn } from "@/lib/utils";
import { canEdit, canSign as roleCanSign, roleLabel } from "@/lib/roles";
import type { DocStatus, ShareRole } from "@/types";
import {
  BadgeCheck,
  Check,
  Lock,
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

/** Lo que se ejecutará si el usuario confirma el aviso. */
type Intent = {
  kind: "sign" | "seal" | "retract";
  run: () => Promise<unknown>;
  /** Para el aviso de "deshacer": a quién le pertenecía la rúbrica. */
  fieldLabel?: string | null;
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
  role,
  status,
  sealed,
  fields,
  signers,
  shares,
  ownerEmail,
  userEmail,
}: {
  documentId: string;
  url: string | null;
  isOwner: boolean;
  /** Permiso de quien está mirando: decide qué puede hacer, no solo qué ve. */
  role: ShareRole;
  status: DocStatus;
  sealed: boolean;
  fields: SignField[];
  signers: Signer[];
  shares: ShareRow[];
  ownerEmail: string;
  userEmail: string;
}) {
  const router = useRouter();
  const supabase = createClient();

  const [placing, setPlacing] = useState(false);
  const [assignTo, setAssignTo] = useState(userEmail);
  const [padOpen, setPadOpen] = useState(false);
  // Firma ya trazada que el usuario está colocando sobre el documento.
  const [pending, setPending] = useState<PendingSignature | null>(null);
  // Campo pedido con un clic y todavía sin confirmar por el servidor.
  const [ghost, setGhost] = useState<GhostField | null>(null);
  const pageSizes = useRef<{ width: number; height: number }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verify, setVerify] = useState<VerifyResult | null>(null);
  const [verifying, setVerifying] = useState(false);
  // Acción irreversible a la espera de confirmación.
  const [intent, setIntent] = useState<Intent | null>(null);
  const [, startRefresh] = useTransition();

  // El campo fantasma vive hasta que el servidor devuelve la lista nueva: en
  // ese momento `fields` cambia de identidad y el recuadro real ocupa su sitio.
  useEffect(() => {
    setGhost(null);
  }, [fields]);

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
  /** Todo lo que había que firmar está firmado: solo falta cerrar. */
  const allSigned = fields.length > 0 && pendingCount === 0;

  // Ya firmé si alguno de mis campos está firmado: el firmante firma una vez,
  // el dueño puede añadir tantas rúbricas como quiera.
  const alreadySigned = fields.some(
    (f) =>
      f.signed &&
      f.assigned_email?.trim().toLowerCase() === userEmail.toLowerCase()
  );

  // Con un sitio ya reservado se firma ahí; si no, se traza la rúbrica y se
  // coloca a mano sobre el documento (la RLS deja crear un campo propio a
  // cualquiera que pueda firmar). El lector no firma en ningún caso.
  const signableField = myField ?? (canEdit(role) ? unassignedPending : null);
  const canSign =
    !sealed &&
    roleCanSign(role) &&
    (signableField !== null || isOwner || !alreadySigned);
  const canEditFields = canEdit(role) && !sealed;

  const candidates = useMemo(() => {
    const set = new Set<string>([userEmail, ...shares.map((s) => s.email)]);
    return [...set];
  }, [shares, userEmail]);

  function refresh() {
    startRefresh(() => router.refresh());
  }

  async function addField(page: number, x: number, y: number) {
    setError(null);
    const email = assignTo.trim().toLowerCase();
    if (!email) return setError("Elige a quién le toca firmar este campo.");

    // El recuadro aparece al instante donde se hizo clic y bloquea los
    // siguientes: antes, mientras se guardaba no pasaba nada visible y dos
    // clics seguidos creaban dos campos encima del otro.
    setGhost({ page, x, y });

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
    if (error) {
      setGhost(null);
      return setError(error.message);
    }
    refresh();
  }

  async function removeField(id: string) {
    const { error } = await supabase
      .from("signature_fields")
      .delete()
      .eq("id", id);
    if (error) return setError(error.message);
    refresh();
  }

  /** Guarda la posición y el tamaño tras mover o redimensionar el campo. */
  async function updateField(
    id: string,
    box: { x: number; y: number; w: number; h: number }
  ) {
    const { error } = await supabase
      .from("signature_fields")
      .update({
        x: Math.round(box.x * 100) / 100,
        y: Math.round(box.y * 100) / 100,
        w: Math.round(box.w * 100) / 100,
        h: Math.round(box.h * 100) / 100,
      })
      .eq("id", id);
    if (error) return setError(error.message);
    refresh();
  }

  /** Envía la rúbrica al servidor para estamparla en `fieldId`. */
  async function sign(fieldId: string | null, png: string) {
    setBusy(true);
    setError(null);
    const { data, error } = await supabase.functions.invoke("sign-pdf", {
      body: { documentId, fieldId, rubric: png },
    });
    setBusy(false);

    if (error || data?.error) {
      setError(data?.error ?? error?.message ?? "No se pudo firmar.");
      return false;
    }
    setPadOpen(false);
    setPending(null);
    setVerify(null);
    refresh();
    return true;
  }

  /**
   * Quita una rúbrica ya estampada (se firmó mal) y reabre el campo. Solo
   * vale mientras el documento no esté sellado -- una vez cerrado, tocar el
   * PDF rompería el sello criptográfico.
   */
  async function retractField(fieldId: string) {
    setBusy(true);
    setError(null);
    const { data, error } = await supabase.functions.invoke("sign-pdf", {
      body: { documentId, fieldId, retract: true },
    });
    setBusy(false);

    if (error || data?.error) {
      setError(data?.error ?? error?.message ?? "No se pudo deshacer la firma.");
      return false;
    }
    setVerify(null);
    refresh();
    return true;
  }

  /** Cierra el documento: sella lo firmado y ya no admite cambios. */
  async function sealDocument() {
    setBusy(true);
    setError(null);
    const { data, error } = await supabase.functions.invoke("sign-pdf", {
      body: { documentId, seal: true },
    });
    setBusy(false);

    if (error || data?.error) {
      setError(data?.error ?? error?.message ?? "No se pudo cerrar.");
      return false;
    }
    setVerify(null);
    refresh();
    return true;
  }

  /** Ejecuta la acción confirmada y cierra el aviso si salió bien. */
  async function runIntent() {
    if (!intent) return;
    const ok = await intent.run();
    if (ok !== false) setIntent(null);
  }

  /**
   * Al terminar de trazar: si el dueño ya reservó un sitio para esta persona,
   * se firma ahí directamente. Si no, la rúbrica pasa a colocarse sobre el
   * documento para que quien firma elija dónde y de qué tamaño.
   */
  async function submitRubric(png: string) {
    if (signableField) {
      // Firmar es definitivo: se avisa antes de estampar nada. Pero firmar no
      // cierra el documento — eso es una decisión aparte.
      setPadOpen(false);
      setIntent({ kind: "sign", run: () => sign(signableField.id, png) });
      return;
    }

    const size = await new Promise<{ w: number; h: number }>((resolve) => {
      const img = new window.Image();
      img.onload = () => {
        // Alto fijo cómodo; el ancho sale de la proporción del trazo.
        const h = DEFAULT_FIELD.h;
        const ratio = img.width / Math.max(img.height, 1);
        resolve({ w: Math.min(340, Math.max(90, h * ratio)), h });
      };
      img.onerror = () => resolve({ w: DEFAULT_FIELD.w, h: DEFAULT_FIELD.h });
      img.src = png;
    });

    const page = pageSizes.current[0] ?? { width: 595, height: 842 };
    setPending({
      src: png,
      page: 1,
      box: {
        ...size,
        x: (page.width - size.w) / 2,
        y: page.height * 0.35,
      },
    });
    setPadOpen(false);
  }

  /** Crea el campo donde el usuario dejó la firma y la estampa allí. */
  async function placePending() {
    if (!pending) return false;
    setBusy(true);
    setError(null);

    const { data: created, error: insErr } = await supabase
      .from("signature_fields")
      .insert({
        document_id: documentId,
        page: pending.page,
        x: Math.round(pending.box.x * 100) / 100,
        y: Math.round(pending.box.y * 100) / 100,
        w: Math.round(pending.box.w * 100) / 100,
        h: Math.round(pending.box.h * 100) / 100,
        assigned_email: userEmail,
        order_index: fields.length,
      })
      .select("id")
      .single();

    if (insErr || !created) {
      setBusy(false);
      setError(insErr?.message ?? "No se pudo guardar la posición.");
      return false;
    }

    return await sign(created.id, pending.src);
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
        {pending && (
          // Fija: al colocar la firma se navega por el documento, y el botón
          // de confirmar tiene que seguir a mano.
          <div className="sticky top-2 z-20 mb-3 flex flex-wrap items-center gap-3 rounded border border-seal/30 border-l-2 border-l-seal bg-seal-soft px-3 py-2.5 shadow-pop">
            <p className="flex-1 text-sm text-seal">
              Arrastra tu firma donde quieras, tira de la esquina para el
              tamaño, o haz clic en otro punto del documento.
            </p>
            <div className="flex shrink-0 gap-2">
              <button
                onClick={() => setPending(null)}
                disabled={busy}
                className="inline-flex h-9 items-center rounded border border-line-strong bg-surface px-3 text-sm font-medium transition-colors hover:bg-surface-2 disabled:opacity-60"
              >
                Cancelar
              </button>
              <button
                onClick={() => setIntent({ kind: "sign", run: placePending })}
                disabled={busy}
                className="inline-flex h-9 items-center gap-2 rounded bg-seal px-4 text-sm font-medium text-seal-ink transition-opacity hover:opacity-90 disabled:opacity-60"
              >
                {busy && <Spinner />}
                {busy ? "Firmando…" : "Firmar"}
              </button>
            </div>
          </div>
        )}

        {placing && !pending && (
          <p className="mb-3 flex items-center gap-2 rounded border-l-2 border-seal bg-seal-soft px-3 py-2 text-sm text-seal">
            {ghost ? (
              <>
                <Spinner className="h-4 w-4 shrink-0" />
                Guardando el campo…
              </>
            ) : (
              <>
                <MapPin className="h-4 w-4 shrink-0" />
                Haz clic en el punto exacto donde debe firmar{" "}
                <strong className="font-medium">{assignTo}</strong>.
              </>
            )}
          </p>
        )}

        {url ? (
          <PdfViewer
            url={url}
            fields={fields}
            placing={placing && canEditFields && !pending && !ghost}
            onPlace={addField}
            ghost={ghost}
            onRemove={canEditFields ? removeField : undefined}
            onUpdate={canEditFields ? updateField : undefined}
            pending={pending}
            onPendingChange={(page, box: FieldBox) =>
              setPending((p) => (p ? { ...p, page, box } : p))
            }
            onPagesReady={(p) => {
              pageSizes.current = p;
            }}
            highlightEmail={userEmail}
          />
        ) : (
          <div className="flex min-h-[50vh] items-center justify-center rounded-lg border border-dashed border-line-strong bg-surface text-sm text-muted">
            No se pudo cargar el documento.
          </div>
        )}
      </div>

      {/* Acta lateral */}
      {/* Fija arriba al hacer scroll: en un documento de varias páginas, el
          visor es mucho más alto que esta columna, y sin `sticky` el aside
          se queda atrás -- desaparece antes de terminar de ver el PDF.
          `order-first` la sube al inicio en móvil (apilado) para que quede
          fija desde el primer scroll; en escritorio vuelve a su lugar a la
          derecha con `lg:order-none`. */}
      <aside className="sticky top-0 z-30 order-first max-h-dvh w-full shrink-0 self-start overflow-y-auto border-b border-line bg-surface p-5 lg:order-none lg:w-[22rem] lg:border-b-0 lg:border-l lg:border-t-0">
        <div className="flex flex-col gap-7">
          <header className="flex items-center justify-between gap-3">
            <h2 className="text-micro uppercase text-muted">Estado</h2>
            <StatusChip status={status} />
          </header>

          {/* Progreso: lo primero que hay que saber. */}
          {!sealed && (
            <p className="text-sm text-muted">
              {noFields
                ? "Todavía no hay campos. Marca sobre el documento dónde va cada firma."
                : pendingCount === 0
                  ? canEdit(role)
                    ? "Todo firmado. El documento sigue abierto: puedes invitar a alguien más o cerrarlo."
                    : "Todos los campos están firmados."
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
          {canEditFields && (
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
                disabled={!!ghost}
                className={cn(
                  "inline-flex h-10 items-center justify-center gap-2 rounded border px-3.5 text-sm font-medium transition-colors disabled:opacity-60",
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
                    <MapPin className="h-4 w-4" />
                    {noFields ? "Colocar mi firma" : "Colocar campo"}
                  </>
                )}
              </button>

              {pendingCount > 0 && (
                <p className="text-xs text-muted">
                  Arrastra un recuadro para moverlo, o tira de su esquina para
                  cambiar el tamaño.
                </p>
              )}
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
                    {/* Se firmó mal: quitar la rúbrica y volver a empezar.
                        Solo mientras el documento siga abierto, y solo quien
                        firmó ahí o quien manda en el documento. */}
                    {f.signed &&
                      !sealed &&
                      (canEditFields ||
                        f.assigned_email?.trim().toLowerCase() ===
                          userEmail.toLowerCase()) && (
                        <button
                          onClick={() =>
                            setIntent({
                              kind: "retract",
                              fieldLabel: f.assigned_email,
                              run: () => retractField(f.id),
                            })
                          }
                          disabled={busy}
                          className="shrink-0 text-xs font-medium text-muted underline decoration-dotted underline-offset-2 transition-colors hover:text-danger disabled:opacity-50"
                        >
                          Deshacer
                        </button>
                      )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Acciones */}
          <section className="flex flex-col gap-2">
            {canSign && !pending && (
              <button
                onClick={() => setPadOpen(true)}
                className="inline-flex h-11 items-center justify-center gap-2 rounded bg-seal px-4 text-sm font-medium text-seal-ink transition-opacity hover:opacity-90"
              >
                <PenLine className="h-4 w-4" /> Firmar
              </button>
            )}

            {canSign && !pending && !signableField && (
              <p className="text-xs text-muted">
                Trazas tu firma y luego la colocas donde quieras.
              </p>
            )}

            {/* Cerrar es un acto aparte de firmar: mientras el documento siga
                abierto se puede invitar a más gente. Y lo cierra quien manda,
                no el último que firme. */}
            {!sealed && allSigned && canEdit(role) && (
              <>
                <button
                  onClick={() => setIntent({ kind: "seal", run: sealDocument })}
                  className="mt-1 inline-flex h-11 items-center justify-center gap-2 rounded border border-seal bg-seal-soft px-4 text-sm font-medium text-seal transition-colors hover:bg-seal hover:text-seal-ink"
                >
                  <Lock className="h-4 w-4" /> Cerrar documento
                </button>
                <p className="text-xs text-muted">
                  Hasta que lo cierres puedes seguir invitando gente a firmar.
                  Al cerrarlo se sella y ya no admite más firmas.
                </p>
              </>
            )}

            {!sealed && allSigned && !canEdit(role) && (
              <p className="text-sm text-muted">
                Ya está todo firmado. Falta que el propietario cierre el
                documento.
              </p>
            )}

            {!canSign && !sealed && !allSigned && (
              <p className="text-sm text-muted">
                {!roleCanSign(role)
                  ? "Tienes permiso de lectura: puedes ver y descargar, pero no firmar. Pídele al dueño que te cambie el permiso a firmante."
                  : alreadySigned
                    ? "Ya firmaste. Falta que firmen los demás."
                    : "El dueño todavía no te ha asignado un campo de firma."}
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
                {/* Quien no es dueño solo ve su propia fila: la RLS no le
                    enseña con quién más está compartido. */}
                <Users className="h-3.5 w-3.5" />{" "}
                {isOwner ? `Con acceso (${shares.length + 1})` : "Tu acceso"}
              </h2>
              {isOwner && (
                <ShareDialog
                  documentId={documentId}
                  shares={shares}
                  ownerEmail={ownerEmail || userEmail}
                  compact
                />
              )}
            </div>
            {shares.length === 0 ? (
              <p className="mt-2.5 text-sm text-muted">
                {isOwner
                  ? "Solo tú puedes ver este documento."
                  : `Tu permiso: ${roleLabel(role).toLowerCase()}.`}
              </p>
            ) : (
              <ul className="mt-2.5 flex flex-col gap-1">
                {shares.map((s) => (
                  <li
                    key={s.email}
                    className="flex items-center justify-between gap-2 rounded border border-line bg-surface-2 px-3 py-2"
                  >
                    <span className="min-w-0 truncate text-sm">
                      {s.email}
                      {s.pending && (
                        <span className="ml-1.5 text-xs text-wait">
                          (pendiente)
                        </span>
                      )}
                    </span>
                    <span className="shrink-0 text-xs text-muted">
                      {roleLabel(s.role)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </aside>

      <ConfirmDialog
        open={!!intent}
        busy={busy}
        title={
          intent?.kind === "seal"
            ? "Vas a cerrar el documento"
            : intent?.kind === "retract"
              ? "Vas a deshacer una firma"
              : "Vas a firmar"
        }
        confirmLabel={
          intent?.kind === "seal"
            ? "Cerrar y sellar"
            : intent?.kind === "retract"
              ? "Sí, deshacer"
              : "Sí, firmar"
        }
        onCancel={() => !busy && setIntent(null)}
        onConfirm={runIntent}
      >
        {intent?.kind === "seal" ? (
          <>
            <p>
              Con esto el documento queda <strong>sellado</strong>: nadie podrá
              volver a firmarlo ni modificarlo, y cualquier cambio posterior
              rompería la firma.
            </p>
            <p>
              Comprueba antes que ya lo compartiste con todo el que tenía que
              firmar y que está diligenciado. Si falta alguien, cancela y
              compártelo primero.
            </p>
          </>
        ) : intent?.kind === "retract" ? (
          <>
            <p>
              Se quita la rúbrica
              {intent.fieldLabel ? (
                <>
                  {" "}
                  de <strong>{intent.fieldLabel}</strong>
                </>
              ) : null}{" "}
              del documento y el campo vuelve a quedar pendiente.
            </p>
            <p>Se puede volver a firmar cuando quieras.</p>
          </>
        ) : (
          <>
            <p>
              Tu firma queda estampada en el documento. Mientras no se cierre,
              se puede deshacer y volver a firmar si algo salió mal.
            </p>
            <p>
              Esto <strong>no cierra</strong> el documento: seguirá abierto para
              invitar a más gente hasta que el propietario lo cierre.
            </p>
          </>
        )}
      </ConfirmDialog>

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
        // Trazar nunca es el acto final: o hay que colocar la firma, o queda
        // el aviso de confirmación. El botón no debe prometer que ya se firmó.
        confirmLabel="Continuar"
        busyLabel="Un momento…"
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
