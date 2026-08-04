"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import {
  FileSignature,
  FolderOpen,
  Inbox,
  LogOut,
  ShieldCheck,
} from "lucide-react";

const nav = [
  { href: "/drive", label: "Mis documentos", icon: FolderOpen },
  { href: "/drive/shared", label: "Compartido conmigo", icon: Inbox },
  { href: "/verify", label: "Verificar", icon: ShieldCheck },
];

export function AppShell({
  email,
  children,
}: {
  email: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createClient();

  async function signOut() {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      {/* Sidebar (desktop) */}
      <aside className="hidden w-64 shrink-0 flex-col border-r p-4 md:flex">
        <div className="mb-6 flex items-center gap-2 px-2 font-semibold">
          <FileSignature className="h-5 w-5 text-primary" /> FirmaDrive
        </div>
        <nav className="flex flex-1 flex-col gap-1">
          {nav.map((item) => (
            <NavLink key={item.href} {...item} active={pathname === item.href} />
          ))}
        </nav>
        <div className="mt-4 border-t pt-4">
          <p className="truncate px-2 text-xs text-muted-foreground">{email}</p>
          <button
            onClick={signOut}
            className="mt-2 flex w-full items-center gap-2 rounded-lg px-2 py-2 text-sm text-muted-foreground hover:bg-muted"
          >
            <LogOut className="h-4 w-4" /> Salir
          </button>
        </div>
      </aside>

      {/* Topbar (mobile) */}
      <header className="flex items-center justify-between border-b p-4 md:hidden">
        <div className="flex items-center gap-2 font-semibold">
          <FileSignature className="h-5 w-5 text-primary" /> FirmaDrive
        </div>
        <button onClick={signOut} className="text-muted-foreground">
          <LogOut className="h-5 w-5" />
        </button>
      </header>

      <main className="flex-1 pb-20 md:pb-0">{children}</main>

      {/* Bottom nav (mobile) */}
      <nav className="fixed inset-x-0 bottom-0 z-10 flex border-t bg-background md:hidden">
        {nav.map((item) => {
          const Icon = item.icon;
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex flex-1 flex-col items-center gap-1 py-3 text-xs",
                active ? "text-primary" : "text-muted-foreground"
              )}
            >
              <Icon className="h-5 w-5" />
              {item.label.split(" ")[0]}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

function NavLink({
  href,
  label,
  icon: Icon,
  active,
}: {
  href: string;
  label: string;
  icon: typeof FolderOpen;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "flex items-center gap-3 rounded-lg px-3 py-2 text-sm",
        active
          ? "bg-primary/10 font-medium text-primary"
          : "text-muted-foreground hover:bg-muted"
      )}
    >
      <Icon className="h-4 w-4" /> {label}
    </Link>
  );
}
