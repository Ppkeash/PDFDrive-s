import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { StatusChip } from "@/components/status-chip";
import { roleLabel } from "@/lib/roles";
import { Inbox } from "lucide-react";
import type { DocStatus } from "@/types";

export default async function SharedPage() {
  const supabase = createClient();

  // RLS: solo devuelve documentos donde el usuario tiene un share vigente.
  const { data: shares } = await supabase
    .from("document_shares")
    .select("role, documents ( id, name, status )")
    .not("documents", "is", null);

  const items = (shares ?? []).filter((s) => s.documents);

  return (
    <div className="mx-auto max-w-4xl px-5 py-8 sm:px-8 sm:py-10">
      <header>
        <h1 className="font-display text-3xl font-semibold">
          Compartido conmigo
        </h1>
        <p className="mt-1.5 text-sm text-muted">
          {items.length === 0
            ? "Nadie ha compartido documentos contigo todavía."
            : `${items.length} ${items.length === 1 ? "documento" : "documentos"} de otras personas`}
        </p>
      </header>

      {items.length === 0 ? (
        <div className="mt-6 flex flex-col items-center rounded-lg border border-dashed border-line-strong bg-surface px-6 py-16 text-center">
          <Inbox className="h-8 w-8 text-line-strong" aria-hidden />
          <h2 className="mt-4 font-display text-lg font-semibold">
            Bandeja vacía
          </h2>
          <p className="mt-1.5 max-w-sm text-sm text-muted">
            Cuando alguien te comparta un documento para firmar o revisar,
            aparecerá aquí.
          </p>
        </div>
      ) : (
        <ul className="mt-6 divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
          {items.map((s, i) => {
            const doc = s.documents as unknown as {
              id: string;
              name: string;
              status: string;
            };
            return (
              <li key={i}>
                <Link
                  href={`/doc/${doc.id}`}
                  className="flex items-center gap-4 px-5 py-3.5 transition-colors hover:bg-surface-2"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {doc.name}
                    </span>
                    <span className="mt-0.5 block text-xs text-muted">
                      Tu permiso: {roleLabel(s.role)}
                    </span>
                  </span>
                  <StatusChip status={doc.status as DocStatus} />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
