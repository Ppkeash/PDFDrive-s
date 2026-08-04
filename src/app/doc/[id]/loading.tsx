import { Spinner } from "@/components/spinner";

export default function Loading() {
  return (
    <div className="flex min-h-dvh flex-col">
      <div className="flex items-center gap-3 border-b border-line bg-surface px-4 py-3 sm:px-5">
        <div className="h-7 w-7 animate-pulse rounded bg-surface-2" />
        <div className="h-5 w-48 animate-pulse rounded bg-surface-2" />
      </div>
      <div className="flex flex-1 items-center justify-center gap-3 text-muted">
        <Spinner className="h-5 w-5 text-seal" />
        <span className="text-sm">Abriendo documento…</span>
      </div>
    </div>
  );
}
