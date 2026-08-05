"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  removeShare,
  shareDocument,
  updateShareRole,
} from "@/app/drive/actions";
import { Spinner } from "@/components/spinner";
import { ROLES, roleLabel, type GrantableRole } from "@/lib/roles";
import { cn } from "@/lib/utils";
import { Clock, Crown, Share2, X } from "lucide-react";

export type ShareRow = {
  email: string;
  role: string;
  /** Invitado que aún no tiene cuenta: el acceso se activa al registrarse. */
  pending: boolean;
};

export function ShareDialog({
  documentId,
  shares,
  ownerEmail,
  compact = false,
}: {
  documentId: string;
  shares: ShareRow[];
  ownerEmail: string;
  /** En el acta lateral basta un enlace: el botón grande vive en la cabecera. */
  compact?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<GrantableRole>("firmante");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Email cuya eliminación está esperando confirmación.
  const [confirming, setConfirming] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Cerrar con Escape: el diálogo es modal, debe comportarse como tal.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  function invite(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    const invited = email.trim().toLowerCase();
    startTransition(async () => {
      const res = await shareDocument(documentId, invited, role);
      if (res.error) return setError(res.error);
      setEmail("");
      router.refresh();

      // Si aún no tiene cuenta conviene decirlo: la invitación queda guardada
      // y se activa sola cuando se registre con ese mismo correo.
      setNotice(
        res.pending
          ? `Invitación guardada. ${invited} verá el documento en cuanto cree su cuenta con ese correo.`
          : `${invited} ya tiene acceso como ${roleLabel(role).toLowerCase()}.`
      );
    });
  }

  function changeRole(target: string, next: GrantableRole) {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const res = await updateShareRole(documentId, target, next);
      if (res.error) return setError(res.error);
      router.refresh();
      setNotice(`${target} ahora es ${roleLabel(next).toLowerCase()}.`);
    });
  }

  function remove(target: string) {
    setError(null);
    setNotice(null);
    setConfirming(null);
    startTransition(async () => {
      const res = await removeShare(documentId, target);
      if (res.error) return setError(res.error);
      router.refresh();
      setNotice(
        res.removedFields
          ? `${target} ya no tiene acceso. Se retiraron sus ${res.removedFields} campo(s) sin firmar.`
          : `${target} ya no tiene acceso.`
      );
    });
  }

  return (
    <>
      {compact ? (
        <button
          onClick={() => setOpen(true)}
          className="text-xs font-medium text-seal transition-opacity hover:opacity-80"
        >
          Gestionar
        </button>
      ) : (
        <button
          onClick={() => setOpen(true)}
          className="inline-flex h-10 items-center gap-2 rounded border border-line-strong bg-surface px-3.5 text-sm font-medium transition-colors hover:bg-surface-2"
        >
          <Share2 className="h-4 w-4" /> Compartir
        </button>
      )}

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4 backdrop-blur-[2px]"
          onClick={() => setOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="share-title"
            onClick={(e) => e.stopPropagation()}
            className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-lg border border-line bg-surface shadow-pop"
          >
            <div className="flex shrink-0 items-center justify-between border-b border-line px-5 py-4">
              <h2 id="share-title" className="font-display text-lg font-semibold">
                Compartir documento
              </h2>
              <button
                onClick={() => setOpen(false)}
                aria-label="Cerrar"
                className="rounded p-1 text-muted transition-colors hover:bg-surface-2 hover:text-ink"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-5">
              {/* Invitar */}
              <form onSubmit={invite} className="flex flex-col gap-2">
                <label
                  htmlFor="share-email"
                  className="text-micro uppercase text-muted"
                >
                  Invitar a alguien
                </label>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <input
                    id="share-email"
                    type="email"
                    required
                    autoFocus
                    placeholder="nombre@email.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="h-11 min-w-0 flex-1 rounded border border-line-strong bg-surface px-3 text-sm outline-none transition-colors placeholder:text-muted/60 focus:border-seal"
                  />
                  <RoleSelect
                    value={role}
                    onChange={(v) => v !== "quitar" && setRole(v)}
                    disabled={pending}
                    ariaLabel="Permiso del invitado"
                  />
                  <button
                    type="submit"
                    disabled={pending}
                    className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded bg-seal px-4 text-sm font-medium text-seal-ink transition-opacity hover:opacity-90 disabled:opacity-60"
                  >
                    {pending && <Spinner />} Invitar
                  </button>
                </div>
                <p className="text-xs text-muted">
                  {ROLES.find((r) => r.value === role)?.hint}
                </p>
              </form>

              {/* Quién tiene acceso */}
              <section className="flex flex-col gap-2 border-t border-line pt-5">
                <h3 className="text-micro uppercase text-muted">
                  Personas con acceso ({shares.length + 1})
                </h3>

                <ul className="flex flex-col gap-1.5">
                  <li className="flex items-center gap-3 rounded border border-line bg-surface-2 px-3 py-2.5">
                    <Crown className="h-4 w-4 shrink-0 text-seal" aria-hidden />
                    <span className="min-w-0 flex-1 truncate text-sm">
                      {ownerEmail || "Tú"}
                    </span>
                    <span className="shrink-0 text-xs text-muted">
                      Propietario
                    </span>
                  </li>

                  {shares.map((s) => (
                    <li
                      key={s.email}
                      className="rounded border border-line bg-surface-2 px-3 py-2.5"
                    >
                      {confirming === s.email ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="min-w-0 flex-1 text-sm">
                            ¿Quitar el acceso a{" "}
                            <strong className="font-medium">{s.email}</strong>?
                            Sus campos sin firmar se eliminarán.
                          </span>
                          <button
                            onClick={() => setConfirming(null)}
                            className="h-8 shrink-0 rounded border border-line-strong bg-surface px-3 text-xs font-medium transition-colors hover:bg-surface-2"
                          >
                            Cancelar
                          </button>
                          <button
                            onClick={() => remove(s.email)}
                            disabled={pending}
                            className="h-8 shrink-0 rounded bg-danger px-3 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
                          >
                            Quitar
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-3">
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm">
                              {s.email}
                            </span>
                            {s.pending && (
                              <span className="mt-0.5 flex items-center gap-1 text-xs text-wait">
                                <Clock className="h-3 w-3" aria-hidden />
                                Pendiente de que cree su cuenta
                              </span>
                            )}
                          </span>
                          <RoleSelect
                            value={s.role}
                            onChange={(v) =>
                              v === "quitar"
                                ? setConfirming(s.email)
                                : changeRole(s.email, v)
                            }
                            disabled={pending}
                            withRemove
                            className="h-9"
                            ariaLabel={`Permiso de ${s.email}`}
                          />
                        </div>
                      )}
                    </li>
                  ))}
                </ul>

                {shares.length === 0 && (
                  <p className="text-sm text-muted">
                    Todavía no lo has compartido con nadie.
                  </p>
                )}
              </section>

              {error && (
                <p
                  role="alert"
                  className="rounded border-l-2 border-danger bg-surface-2 px-3 py-2 text-sm text-danger"
                >
                  {error}
                </p>
              )}
              {notice && (
                <p className="rounded border-l-2 border-ok bg-ok-soft px-3 py-2 text-sm text-ok">
                  {notice}
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/**
 * Selector de permiso. Igual que en Drive, "Quitar acceso" vive dentro del
 * mismo menú: donde se mira el permiso es donde se quiere revocarlo.
 */
function RoleSelect({
  value,
  onChange,
  disabled,
  withRemove,
  ariaLabel,
  className = "h-11",
}: {
  value: string;
  onChange: (v: GrantableRole | "quitar") => void;
  disabled?: boolean;
  withRemove?: boolean;
  ariaLabel: string;
  className?: string;
}) {
  // Un rol desconocido (o el heredado "propietario") no tiene opción propia:
  // se muestra como lector para no dejar el selector en blanco.
  const safe = ROLES.some((r) => r.value === value) ? value : "lector";

  return (
    <select
      aria-label={ariaLabel}
      value={safe}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value as GrantableRole | "quitar")}
      className={cn(
        "shrink-0 rounded border border-line-strong bg-surface px-2.5 text-sm outline-none transition-colors focus:border-seal disabled:opacity-60",
        className
      )}
    >
      {ROLES.map((r) => (
        <option key={r.value} value={r.value}>
          {r.label}
        </option>
      ))}
      {withRemove && (
        <>
          <option disabled>──────────</option>
          <option value="quitar">Quitar acceso</option>
        </>
      )}
    </select>
  );
}
