import { cn } from "@/lib/utils";
import type { DocStatus } from "@/types";

/**
 * El estado se lee de un vistazo: forma + color, no solo texto. El punto
 * lleva el color semántico (verde firmado / ámbar en firma), separado del
 * acento de marca para que nunca compitan.
 */
const STATUS: Record<
  DocStatus,
  { label: string; dot: string; text: string; bg: string }
> = {
  borrador: {
    label: "Borrador",
    dot: "bg-muted",
    text: "text-muted",
    bg: "bg-surface-2",
  },
  en_firma: {
    label: "En firma",
    dot: "bg-wait",
    text: "text-wait",
    bg: "bg-wait-soft",
  },
  firmado: {
    label: "Firmado",
    dot: "bg-ok",
    text: "text-ok",
    bg: "bg-ok-soft",
  },
  archivado: {
    label: "Archivado",
    dot: "bg-muted",
    text: "text-muted",
    bg: "bg-surface-2",
  },
};

export function StatusChip({
  status,
  className,
}: {
  status: DocStatus;
  className?: string;
}) {
  const s = STATUS[status] ?? STATUS.borrador;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
        s.bg,
        s.text,
        className
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", s.dot)} aria-hidden />
      {s.label}
    </span>
  );
}
