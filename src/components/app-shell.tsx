"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { ThemeToggle } from "@/components/theme-toggle";
import { cn } from "@/lib/utils";
import { CreditCard, FolderOpen, Inbox, LogOut, ShieldCheck } from "lucide-react";

const nav = [
  { href: "/drive", label: "Mis documentos", short: "Mis", icon: FolderOpen },
  {
    href: "/drive/shared",
    label: "Compartido conmigo",
    short: "Compartido",
    icon: Inbox,
  },
  { href: "/verify", label: "Verificar", short: "Verificar", icon: ShieldCheck },
  { href: "/planes", label: "Mi plan", short: "Plan", icon: CreditCard },
];

/** Lo justo para el distintivo de la barra; el detalle vive en /planes. */
export interface ResumenDePlan {
  en_prueba?: boolean;
  vence?: string | null;
  restantes?: number;
  sin_espacio?: boolean;
}

/**
 * Un distintivo callado, no un aviso.
 *
 * El aviso del Drive solo aparece cuando algo aprieta -- quedan pocos
 * documentos o la prueba se acaba -- y eso dejaba un hueco: con la prueba
 * recién empezada nadie se enteraba de que estaba en una, y `/planes` no
 * tenía enlace en ninguna parte. Enterarse de que había un plazo el día que
 * se vence es la peor forma de descubrirlo.
 */
function DistintivoDePlan({ plan }: { plan?: ResumenDePlan | null }) {
  if (!plan || plan.sin_espacio || !plan.en_prueba || !plan.vence) return null;

  const dias = Math.max(
    0,
    Math.ceil((new Date(plan.vence).getTime() - Date.now()) / 86_400_000)
  );

  return (
    <Link
      href="/planes"
      className="mx-2 mb-1 flex items-center justify-between gap-2 rounded border border-line bg-surface-2 px-2.5 py-2 text-xs transition-colors hover:border-seal"
    >
      <span className="text-muted">Prueba gratuita</span>
      <span className="font-medium tabular-nums">
        {dias === 0 ? "termina hoy" : `${dias} día${dias === 1 ? "" : "s"}`}
      </span>
    </Link>
  );
}

export function AppShell({
  email,
  plan = null,
  children,
}: {
  email: string;
  plan?: ResumenDePlan | null;
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
      {/* Rail (escritorio) */}
      <aside className="hidden w-64 shrink-0 flex-col border-r border-line bg-surface md:flex">
        <div className="px-5 py-6">
          <Wordmark />
        </div>

        <nav className="flex flex-1 flex-col gap-0.5 px-3">
          {nav.map((item) => (
            <NavLink key={item.href} {...item} active={pathname === item.href} />
          ))}
        </nav>

        <div className="border-t border-line p-3">
          <DistintivoDePlan plan={plan} />
          <div className="flex items-center justify-between gap-2 px-2 py-1">
            <p className="truncate text-xs text-muted" title={email}>
              {email}
            </p>
            <ThemeToggle />
          </div>
          <button
            onClick={signOut}
            className="mt-1 flex w-full items-center gap-2.5 rounded px-2 py-2 text-sm text-muted transition-colors hover:bg-surface-2 hover:text-ink"
          >
            <LogOut className="h-4 w-4" /> Cerrar sesión
          </button>
        </div>
      </aside>

      {/* Barra superior (móvil) */}
      <header className="flex items-center justify-between border-b border-line bg-surface px-4 py-3 md:hidden">
        <Wordmark />
        <div className="flex items-center gap-1">
          <ThemeToggle />
          <button
            onClick={signOut}
            className="rounded p-2 text-muted transition-colors hover:bg-surface-2"
            aria-label="Cerrar sesión"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </header>

      <main className="flex-1 pb-24 md:pb-0">{children}</main>

      {/* Navegación inferior (móvil) */}
      <nav className="fixed inset-x-0 bottom-0 z-20 flex border-t border-line bg-surface md:hidden">
        {nav.map(({ href, short, icon: Icon }) => {
          const active = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative flex flex-1 flex-col items-center gap-1 py-3 text-xs transition-colors",
                active ? "text-seal" : "text-muted"
              )}
            >
              {active && (
                <span className="absolute inset-x-6 top-0 h-0.5 rounded-full bg-seal" />
              )}
              <Icon className="h-[18px] w-[18px]" />
              {short}
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
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative flex items-center gap-3 rounded px-3 py-2 text-sm transition-colors",
        active
          ? "bg-seal-soft font-medium text-seal"
          : "text-muted hover:bg-surface-2 hover:text-ink"
      )}
    >
      {active && (
        <span className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-seal" />
      )}
      <Icon className="h-4 w-4 shrink-0" />
      {label}
    </Link>
  );
}

function Wordmark() {
  return (
    <Link href="/drive" className="flex items-center gap-2.5">
      <svg viewBox="0 0 24 24" className="h-6 w-6 shrink-0" aria-hidden="true">
        <circle cx="12" cy="12" r="10" fill="rgb(var(--seal))" />
        <circle
          cx="12"
          cy="12"
          r="7"
          fill="none"
          stroke="rgb(var(--seal-ink))"
          strokeOpacity="0.55"
          strokeWidth="0.75"
        />
        <path
          d="M8.5 13.2c1.6.9 2.6-2.4 4-1.7 1 .5.3 2.4 1.6 2.2.8-.1 1.2-.8 1.4-1.5"
          fill="none"
          stroke="rgb(var(--seal-ink))"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
      </svg>
      <span className="font-display text-lg font-semibold tracking-tight">
        FirmaDrive
      </span>
    </Link>
  );
}
