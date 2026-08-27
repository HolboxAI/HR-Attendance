/** Contextual loading shapes. Opacity-only shimmer - see .bx-skeleton. */
export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`bx-skeleton ${className}`} aria-hidden />;
}

export function TileSkeleton() {
  return (
    <div className="bx-card px-4 py-4">
      <Skeleton className="size-9 rounded-md" />
      <Skeleton className="mt-3 h-4 w-24" />
      <Skeleton className="mt-2 h-7 w-12" />
    </div>
  );
}

export function RowsSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="space-y-2 p-4">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  );
}
