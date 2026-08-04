"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { shareDocument } from "@/app/drive/actions";
import { Share2, X } from "lucide-react";

type Role = "editor" | "firmante" | "lector";

export function ShareDialog({ documentId }: { documentId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("firmante");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

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
        className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium"
      >
        <Share2 className="h-4 w-4" /> Compartir
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl border bg-background p-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold">Compartir documento</h2>
              <button onClick={() => setOpen(false)} aria-label="Cerrar">
                <X className="h-5 w-5 text-muted-foreground" />
              </button>
            </div>

            <form onSubmit={submit} className="space-y-3">
              <input
                type="email"
                required
                placeholder="email@persona.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-lg border bg-transparent px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
              />
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as Role)}
                className="w-full rounded-lg border bg-background px-3 py-2 text-sm"
              >
                <option value="firmante">Firmante</option>
                <option value="editor">Editor</option>
                <option value="lector">Lector</option>
              </select>
              {error && <p className="text-sm text-red-500">{error}</p>}
              <button
                type="submit"
                disabled={pending}
                className="w-full rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
              >
                {pending ? "Compartiendo..." : "Compartir"}
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
