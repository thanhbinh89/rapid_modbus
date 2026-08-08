/**
 * The shapes the UI works with: a poll definition plus how to display it.
 *
 * Display settings are kept out of `core/` so the polling engine never has to
 * know what a cell looks like.
 */

import type { FormatId } from '../protocol/formats';
import type { MasterOptions, SerialMode } from '../core/master';
import type { PollDefinition } from '../core/scheduler';
import type { SerialSettings } from '../transport/link';

/** Engineering value = factor x raw + offset. */
export interface Scaling {
  factor: number;
  offset: number;
}

export const IDENTITY_SCALING: Scaling = { factor: 1, offset: 0 };

export function isIdentityScaling(scaling: Scaling | undefined): boolean {
  return !scaling || (scaling.factor === 1 && scaling.offset === 0);
}

/** Everything the operator can configure about one row of the grid. */
export interface RowConfig {
  /** Label, e.g. "Voltage L1". */
  name?: string;
  /** Overrides the definition's default format. */
  format?: FormatId;
  scaling?: Scaling;
  /** Shown after the value, e.g. "V" or "kWh". */
  unit?: string;
}

/**
 * A deliberately small palette. Operators pick a meaning, not a colour, and a
 * fixed set is guaranteed to stay legible in both themes.
 */
export type ConditionalColor = 'red' | 'amber' | 'green' | 'blue';

export const CONDITIONAL_COLORS: ConditionalColor[] = ['red', 'amber', 'green', 'blue'];

export interface ColorRule {
  id: string;
  /** Inclusive bounds, evaluated against the scaled value. */
  min: number;
  max: number;
  color: ConditionalColor;
}

export interface DisplayConfig {
  /** Format for rows without an override. */
  defaultFormat: FormatId;
  rows: Record<number, RowConfig>;
  /**
   * Raw register value to label, e.g. 0 = Off, 1 = Run, 2 = Fault.
   * Applies across the whole definition, as status codes usually do.
   */
  valueNames: Record<number, string>;
  colorRules: ColorRule[];
}

export interface Definition extends PollDefinition {
  display: DisplayConfig;
}

export interface DefinitionState {
  values: number[] | boolean[] | null;
  error: { message: string; hint: string; exceptionCode?: number } | null;
  at: number | null;
  consecutiveErrors: number;
}

export const EMPTY_STATE: DefinitionState = {
  values: null,
  error: null,
  at: null,
  consecutiveErrors: 0,
};

export function defaultDisplay(): DisplayConfig {
  return { defaultFormat: 'uint16', rows: {}, valueNames: {}, colorRules: [] };
}

export interface ConnectionConfig {
  settings: SerialSettings;
  mode: SerialMode;
  master: MasterOptions;
}
