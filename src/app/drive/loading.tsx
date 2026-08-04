import { RowSkeleton } from "@/components/spinner";

export default function Loading() {
  return (
    <div className="mx-auto max-w-4xl px-5 py-8 sm:px-8 sm:py-10">
      <div className="h-9 w-56 animate-pulse rounded bg-surface-2" />
      <div className="mt-2 h-4 w-40 animate-pulse rounded bg-surface-2" />
      <div className="mt-6 divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
        {Array.from({ length: 5 }).map((_, i) => (
          <RowSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}
