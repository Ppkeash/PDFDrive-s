import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { FileText, Inbox } from "lucide-react";

export default async function SharedPage() {
  const supabase = createClient();

  // RLS: solo devuelve documentos donde el usuario tiene un share vigente.
  const { data: shares } = await supabase
    .from("document_shares")
    .select("role, documents ( id, name, status )")
    .not("documents", "is", null);

  const items = (shares ?? []).filter((s) => s.documents);

  return (
    <div className="mx-auto max-w-5xl p-4 sm:p-6">
      <h1 className="mb-6 text-2xl font-semibold">Compartido conmigo</h1>

      {items.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-16 text-center">
          <Inbox className="mb-3 h-8 w-8 text-muted-foreground" />
          <p className="font-medium">Nada compartido todavía</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Los documentos que otros compartan contigo aparecerán aquí.
          </p>
        </div>
      ) : (
        <ul className="divide-y rounded-xl border">
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
                  className="flex items-center gap-3 p-4 hover:bg-muted/50"
                >
                  <FileText className="h-5 w-5 text-muted-foreground" />
                  <span className="flex-1 truncate font-medium">
                    {doc.name}
                  </span>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs capitalize text-muted-foreground">
                    {s.role}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
