"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { shareDocument } from "@/app/drive/actions";
import { Spinner } from "@/components/spinner";
import { Share2, X } from "lucide-react";

type Role = "editor" | "firmante" | "lector";

const ROLES: { value: Role; label: string; hint: string }[] = [
  { value: "firmante", label: "Firmante", hint: "Puede ver y firmar" },
  { value: "editor", label: "Editor", hint: "Puede ver, firmar y editar" },
  { value: "lector", label: "Lector", hint: "Solo puede ver y descargar" },
];

export function ShareDialog({ documentId }: { documentId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("firmante");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Cerrar con Escape: el diálogo es modal, debe comportarse como tal.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await shareDocument(documentId, email.trim(), role);
      if (res.error) return setError(res.error);
      setEmail("");
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex h-10 items-center gap-2 rounded border border-line-strong bg-surface px-3.5 text-sm font-medium transition-colors hover:bg-surface-2"
      >
        <Share2 className="h-4 w-4" /> Compartir
      </button>

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
            className="w-full max-w-md overflow-hidden rounded-lg border border-line bg-surface shadow-pop"
          >
            <div className="flex items-center justify-between border-b border-line px-5 py-4">
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

            <form onSubmit={submit} className="flex flex-col gap-4 p-5">
              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="share-email"
                  className="text-micro uppercase text-muted"
                >
                  Email de la persona
                </label>
                <input
                  id="share-email"
                  type="email"
                  required
                  autoFocus
                  placeholder="nombre@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="h-11 rounded border border-line-strong bg-surface px-3 text-sm outline-none transition-colors placeholder:text-muted/60 focus:border-seal"
                />
              </div>

              <fieldset className="flex flex-col gap-1.5">
                <legend className="mb-1.5 text-micro uppercase text-muted">
                  Permiso
                </legend>
                <div className="flex flex-col gap-1">
                  {ROLES.map((r) => (
                    <label
                      key={r.value}
                      className="flex cursor-pointer items-center gap-3 rounded border border-line px-3 py-2.5 transition-colors has-[:checked]:border-seal has-[:checked]:bg-seal-soft"
                    >
                      <input
                        type="radio"
                        name="role"
                        value={r.value}
                        checked={role === r.value}
                        onChange={() => setRole(r.value)}
                        className="accent-seal"
                      />
                      <span className="flex-1">
                        <span className="block text-sm font-medium">
                          {r.label}
                        </span>
                        <span className="block text-xs text-muted">
                          {r.hint}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>

              {error && (
                <p
                  role="alert"
                  className="rounded border-l-2 border-danger bg-surface-2 px-3 py-2 text-sm text-danger"
                >
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={pending}
                className="inline-flex h-11 items-center justify-center gap-2 rounded bg-seal px-4 text-sm font-medium text-seal-ink transition-opacity hover:opacity-90 disabled:opacity-60"
              >
                {pending && <Spinner />}
                {pending ? "Compartiendo…" : "Compartir"}
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
