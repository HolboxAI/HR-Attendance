import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * The Boxcode mark, redrawn as vector.
 *
 * An SVG rather than the PNG so it stays sharp at the 96px the auth page uses
 * it at, inherits colour from `currentColor`, and costs no extra request. The
 * geometry is on a 4px pixel grid because the original is pixel art - keeping
 * that grid is what stops it reading as a generic box icon.
 */
export function BoxcodeMark({ className, ...props }: React.ComponentProps<'svg'>) {
  return (
    <svg
      viewBox="0 0 32 28"
      fill="currentColor"
      shapeRendering="crispEdges"
      aria-hidden
      className={cn('size-8', className)}
      {...props}
    >
      {/* top bolts */}
      <rect x="4" y="0" width="8" height="4" />
      <rect x="20" y="0" width="8" height="4" />
      {/* top plank */}
      <rect x="0" y="4" width="32" height="5" />
      {/* side posts, with the slat between them */}
      <rect x="0" y="9" width="5" height="10" />
      <rect x="27" y="9" width="5" height="10" />
      <rect x="9" y="11" width="14" height="6" />
      {/* bottom plank */}
      <rect x="0" y="19" width="32" height="5" />
      {/* feet */}
      <rect x="4" y="24" width="8" height="4" />
      <rect x="20" y="24" width="8" height="4" />
    </svg>
  );
}

/**
 * Mark plus wordmark. `markClassName` sizes the icon; the wordmark tracks it.
 *
 * The trailing bar is the cursor from the original lockup. It is decorative,
 * so it is aria-hidden and the accessible name comes from the text itself.
 */
export function BoxcodeLogo({
  className,
  markClassName,
  ...props
}: React.ComponentProps<'div'> & { markClassName?: string }) {
  return (
    <div className={cn('flex items-center gap-2.5', className)} {...props}>
      <BoxcodeMark className={cn('size-6', markClassName)} />
      <span className="font-display text-xl font-semibold leading-none tracking-tight">
        boxcode
      </span>
      <span
        aria-hidden
        className="-ml-1.5 h-[1.05em] w-[3px] rounded-[1px] bg-[#8B7CF6]"
      />
    </div>
  );
}
