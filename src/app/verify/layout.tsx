import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/app-shell";

// /verify vive en la misma navegación que /drive, así que comparte el shell:
// sin esto, al entrar aquí desaparecía el rail lateral.
export default async function VerifyLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  return <AppShell email={user.email ?? ""}>{children}</AppShell>;
}
