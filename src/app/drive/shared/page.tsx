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
    // `deleted_at` hay que pedirlo y filtrarlo: un documento que su
    // propietario mandó a la papelera seguía apareciendo aquí como si
    // nada. La política de lectura de la base ahora también lo esconde
    // (migración 0021), pero el filtro explícito deja claro qué se lista.
    .select("role, documents ( id, name, status, deleted_at )")
    .not("documents", "is", null);

  // El `select` anidado llega tipado como lista aunque sea una sola fila, así
  // que se normaliza aquí una vez en vez de ir casteando en cada uso.
  type DocCompartido = {
    id: string;
    name: string;
    status: DocStatus;
    deleted_at: string | null;
  };

  const items = (shares ?? [])
    .map((s) => ({
      role: s.role as string,
      doc: (Array.isArray(s.documents)
        ? s.documents[0]
        : s.documents) as unknown as DocCompartido | null,
    }))
    .filter(
      (s): s is { role: string; doc: DocCompartido } =>
        Boolean(s.doc) && !s.doc!.deleted_at
    );

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
          {items.map((s) => {
            const doc = s.doc;
            return (
              <li key={doc.id}>
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
