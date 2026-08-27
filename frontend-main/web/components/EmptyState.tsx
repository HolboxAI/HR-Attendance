import type { LucideIcon } from 'lucide-react';

/**
 * Empty states say what WOULD appear here, never "no data". The wording is
 * the caller's job because only the screen knows what belongs on it; this
 * component only guarantees the shape stays consistent.
 */
export function EmptyState({
  icon: Icon, title, hint,
}: {
  icon?: LucideIcon; title: string; hint?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      {Icon && (
        <span className="mb-3 flex size-10 items-center justify-center rounded-full bg-surface-2 text-ink-3">
          <Icon className="size-5" aria-hidden />
        </span>
      )}
      <p className="text-sm font-medium text-ink">{title}</p>
      {hint && <p className="mt-1 max-w-sm text-xs text-ink-3">{hint}</p>}
    </div>
  );
}
