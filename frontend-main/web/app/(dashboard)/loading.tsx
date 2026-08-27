import { RowsSkeleton, Skeleton, TileSkeleton } from '@/components/Skeleton';

/** Route-level fallback: the page's shape, not a spinner. */
export default function Loading() {
  return (
    <div className="space-y-8" aria-busy="true" aria-label="Loading">
      <div>
        <Skeleton className="h-8 w-64" />
        <Skeleton className="mt-2 h-4 w-96 max-w-full" />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => <TileSkeleton key={i} />)}
      </div>
      <div className="bx-card"><RowsSkeleton /></div>
    </div>
  );
}
