import { RowSkeleton } from "@/components/spinner";

export default function Loading() {
  return (
    <div className="mx-auto max-w-5xl p-4 sm:p-6">
      <div className="mb-6 h-8 w-48 animate-pulse rounded bg-muted" />
      <div className="divide-y rounded-xl border">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="animate-pulse">
            <RowSkeleton />
          </div>
        ))}
      </div>
    </div>
  );
}
