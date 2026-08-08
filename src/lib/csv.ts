/**
 * CSV export and file download, done entirely in the browser.
 */

import { formatAddress } from './plcAddress';
import type { Definition } from '../store/types';
import type { GridRow } from './rows';

function escapeCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function toCsv(rows: string[][]): string {
  return rows.map((row) => row.map(escapeCell).join(',')).join('\n');
}

export function definitionToCsv(
  definition: Definition,
  rows: GridRow[],
  plcBase1: boolean,
): string {
  // Both the raw and the scaled value are exported: the raw one is what the
  // device actually returned, and that is what someone re-checking the
  // scaling factors needs to see.
  const table: string[][] = [['address', 'name', 'format', 'raw', 'value', 'unit']];
  for (const row of rows) {
    table.push([
      formatAddress(definition.fc, row.address, plcBase1),
      row.name,
      row.format,
      row.decoded?.text ?? '',
      row.text,
      row.unit,
    ]);
  }
  return toCsv(table);
}

/** Triggers a download without a server round trip. */
export function downloadText(filename: string, text: string, mime = 'text/plain'): void {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  // Revoking immediately can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** A filename-safe timestamp, so exports from one site sort together. */
export function timestampSuffix(at = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}` +
    `-${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}`
  );
}
