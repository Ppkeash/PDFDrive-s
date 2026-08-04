import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// La app es una herramienta de trabajo, no un sitio de marketing: la portada
// es directamente el acceso (o el drive, si ya hay sesión).
export default async function Home() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  redirect(user ? "/drive" : "/login");
}
