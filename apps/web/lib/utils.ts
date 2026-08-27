import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * The shadcn class merger.
 *
 * clsx resolves the conditionals; tailwind-merge then drops the losers of any
 * conflicting pair, so a caller's `px-6` beats a component's built-in `px-4`
 * instead of both landing in the class list and letting stylesheet order pick
 * the winner.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
