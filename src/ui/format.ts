/** Display helpers shared by the diagnostic views. */

import type { ConditionalColor } from '../store/types';

/**
 * Tailwind classes per conditional colour. Fixed pairs so every band stays
 * readable in both themes — an operator should never meet an unreadable cell.
 */
export const COLOR_CLASSES: Record<ConditionalColor, string> = {
  red: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200',
  amber: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200',
  green: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
  blue: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200',
};

export function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');
}

/** Wall-clock time with milliseconds — frame timing matters when debugging. */
export function clockTime(at: number): string {
  const date = new Date(at);
  const pad = (n: number, width = 2) => String(n).padStart(width, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
}
