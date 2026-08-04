import { Spinner } from "@/components/spinner";

export default function Loading() {
  return (
    <div className="flex min-h-dvh flex-col">
      <div className="flex items-center gap-3 border-b p-4">
        <div className="h-5 w-5 animate-pulse rounded bg-muted" />
        <div className="h-5 w-48 animate-pulse rounded bg-muted" />
      </div>
      <div className="flex flex-1 items-center justify-center">
        <Spinner className="h-8 w-8 text-primary" />
      </div>
    </div>
  );
}
