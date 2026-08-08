/**
 * Number rendering for the grid.
 *
 * Scaling turns clean integers into binary-float noise — 2314 x 0.1 is
 * 231.40000000000003 — and an operator reading a panel should never see that.
 */

/** Trims float noise without hiding genuinely small or large values. */
export function formatNumber(value: number, precision = 9): string {
  if (!Number.isFinite(value)) return String(value);
  return String(Number(value.toPrecision(precision)));
}
