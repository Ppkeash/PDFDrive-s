import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn("h-4 w-4 animate-spin", className)} />;
}

// Overlay a pantalla completa para bloqueos breves (navegación, procesos).
export function LoadingOverlay({ label }: { label?: string }) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-background/70 backdrop-blur-sm">
      <Spinner className="h-8 w-8 text-primary" />
      {label && <p className="text-sm text-muted-foreground">{label}</p>}
    </div>
  );
}

// Fila esqueleto para listas mientras cargan datos.
export function RowSkeleton() {
  return (
    <div className="flex items-center gap-3 p-4">
      <div className="h-5 w-5 shrink-0 rounded bg-muted" />
      <div className="flex-1 space-y-2">
        <div className="h-4 w-1/3 rounded bg-muted" />
        <div className="h-3 w-20 rounded bg-muted" />
      </div>
      <div className="h-5 w-16 rounded-full bg-muted" />
    </div>
  );
}
