import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export function Spinner({ className }: { className?: string }) {
  return (
    <Loader2 className={cn("h-4 w-4 animate-spin", className)} aria-hidden />
  );
}

// Overlay a pantalla completa para bloqueos breves (navegación, procesos).
export function LoadingOverlay({ label }: { label?: string }) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-paper/70 backdrop-blur-sm">
      <Spinner className="h-7 w-7 text-seal" />
      {label && <p className="text-sm text-muted">{label}</p>}
    </div>
  );
}

// Fila esqueleto para el registro mientras cargan los datos.
export function RowSkeleton() {
  return (
    <div className="flex items-center gap-4 px-5 py-4">
      <div className="h-8 w-8 shrink-0 animate-pulse rounded bg-surface-2" />
      <div className="flex-1 space-y-2">
        <div className="h-3.5 w-1/3 animate-pulse rounded bg-surface-2" />
        <div className="h-3 w-24 animate-pulse rounded bg-surface-2" />
      </div>
      <div className="h-5 w-20 animate-pulse rounded bg-surface-2" />
    </div>
  );
}
