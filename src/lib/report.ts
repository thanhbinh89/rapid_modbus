/**
 * Diagnostic report — one file that answers "what did you actually see?".
 *
 * When a device will not talk and the person on site runs out of ideas, this
 * is what gets emailed back to the office: the exact serial settings, what was
 * asked for, what came back, and the raw bytes. Without it the conversation is
 * someone describing a hex dump over the phone.
 */

import type { MasterOptions, MasterStats, SerialMode } from '../core/master';
import type { SerialSettings } from '../transport/link';
import { FUNCTION_LABELS } from '../protocol/pdu';
import type { FunctionCode } from '../protocol/pdu';
import type { Definition, DefinitionState } from '../store/types';
import { buildRows } from './rows';
import { formatAddress } from './plcAddress';
import { clockTime, hex } from '../ui/format';

export interface TrafficLine {
  at: number;
  direction: 'tx' | 'rx';
  bytes: Uint8Array;
  error?: string;
}

export interface ReportInput {
  settings: SerialSettings;
  mode: SerialMode;
  master: MasterOptions;
  stats: MasterStats;
  plcBase1: boolean;
  definitions: Definition[];
  states: Record<string, DefinitionState>;
  traffic: TrafficLine[];
  generatedAt?: Date;
}

export function buildReport(input: ReportInput): string {
  const at = input.generatedAt ?? new Date();
  const out: string[] = [];

  out.push('rapid_modbus diagnostic report');
  out.push(`Generated  ${at.toISOString()}`);
  out.push(`Agent      ${userAgent()}`);
  out.push('');

  out.push(section('Connection'));
  out.push(`  Mode           ${input.mode.toUpperCase()}`);
  out.push(`  Baud rate      ${input.settings.baudRate}`);
  out.push(
    `  Framing        ${input.settings.dataBits}-${input.settings.parity}-${input.settings.stopBits}`,
  );
  out.push(`  Timeout        ${input.master.responseTimeoutMs} ms`);
  out.push(`  Retries        ${input.master.retries}`);
  out.push(`  Frame delay    ${input.master.interFrameDelayMs} ms`);
  out.push('');

  out.push(section('Totals'));
  out.push(`  Tx / Rx / Err  ${input.stats.tx} / ${input.stats.rx} / ${input.stats.errors}`);
  out.push(
    `  Response ms    min ${ms(input.stats.minResponseMs)}  avg ${ms(input.stats.avgResponseMs)}  max ${ms(input.stats.maxResponseMs)}`,
  );
  out.push('');

  for (const definition of input.definitions) {
    const state = input.states[definition.id];
    out.push(section(`Definition: ${definition.name}`));
    out.push(`  Slave          ${definition.slaveId}`);
    out.push(
      `  Function       ${FUNCTION_LABELS[definition.fc as FunctionCode] ?? definition.fc}`,
    );
    out.push(
      `  Range          ${formatAddress(definition.fc, definition.address, input.plcBase1)}` +
        ` .. ${formatAddress(definition.fc, definition.address + definition.quantity - 1, input.plcBase1)}` +
        ` (${definition.quantity})`,
    );
    out.push(`  Scan rate      ${definition.scanRateMs} ms`);
    out.push(`  Enabled        ${definition.enabled ? 'yes' : 'no'}`);

    if (state?.error) {
      out.push(`  Last error     ${state.error.message}`);
      if (state.error.hint) out.push(`                 ${state.error.hint}`);
      out.push(`  Failures       ${state.consecutiveErrors} in a row`);
    }
    if (state?.at) out.push(`  Last read      ${new Date(state.at).toISOString()}`);

    out.push('');
    if (state?.values) {
      const rows = buildRows(definition, state);
      const width = Math.max(4, ...rows.map((row) => row.name.length));
      out.push(`  ${'ADDRESS'.padEnd(10)}${'NAME'.padEnd(width + 2)}VALUE`);
      for (const row of rows) {
        const address = formatAddress(definition.fc, row.address, input.plcBase1);
        out.push(`  ${address.padEnd(10)}${row.name.padEnd(width + 2)}${row.text || '-'}`);
      }
    } else {
      out.push('  (no data read)');
    }
    out.push('');
  }

  out.push(section(`Traffic (${input.traffic.length} entries)`));
  if (input.traffic.length === 0) {
    out.push('  (nothing captured)');
  } else {
    for (const line of input.traffic) {
      const body = line.bytes.length > 0 ? hex(line.bytes) : '(no data)';
      const suffix = line.error ? `  -- ${line.error}` : '';
      out.push(`  ${clockTime(line.at)}  ${line.direction.toUpperCase()}  ${body}${suffix}`);
    }
  }
  out.push('');

  return out.join('\n');
}

function section(title: string): string {
  return `${title}\n${'-'.repeat(title.length)}`;
}

function ms(value: number | null): string {
  return value === null ? '-' : String(Math.round(value));
}

function userAgent(): string {
  return typeof navigator === 'undefined' ? 'unknown' : navigator.userAgent;
}
