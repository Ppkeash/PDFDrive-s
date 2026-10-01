import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppShell, type ResumenDePlan } from "@/components/app-shell";

// Misma envoltura que el Drive: se llega aquí desde dentro de la aplicación,
// así que tiene que conservar la barra y la sesión.
export default async function PlanesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  // Para el distintivo de la barra. Si falla, la barra se dibuja igual: un
  // indicador de plan no vale romper toda la navegación.
  const { data: cupo } = await supabase.rpc("mi_cupo_de_documentos");

  return (
    <AppShell
      email={user.email ?? ""}
      plan={(cupo as ResumenDePlan | null) ?? null}
    >
      {children}
    </AppShell>
  );
}
