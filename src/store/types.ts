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

export interface DisplayConfig {
  /** Format for rows without an override. */
  defaultFormat: FormatId;
  /** Per-row format override, keyed by offset from the start address. */
  formats: Record<number, FormatId>;
  /** Operator-supplied label per row, e.g. "Voltage L1". */
  names: Record<number, string>;
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
  return { defaultFormat: 'uint16', formats: {}, names: {} };
}

export interface ConnectionConfig {
  settings: SerialSettings;
  mode: SerialMode;
  master: MasterOptions;
}
