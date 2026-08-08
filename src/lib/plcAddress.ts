/**
 * PLC (base-1) addressing.
 *
 * Device datasheets almost always quote 4xxxx-style addresses while the wire
 * protocol is base-0. Getting this wrong by one is the single most common
 * reason a read comes back as "illegal data address", so the conversion lives
 * in one tested place.
 *
 *   coils            0xxxx   FC 01, 05, 15
 *   discrete inputs  1xxxx   FC 02
 *   input registers  3xxxx   FC 04
 *   holding regs     4xxxx   FC 03, 06, 16
 */

import { FC } from '../protocol/pdu';

export type DataTable = 'coil' | 'discrete' | 'input' | 'holding';

const TABLE_PREFIX: Record<DataTable, number> = {
  coil: 0,
  discrete: 1,
  input: 3,
  holding: 4,
};

export function tableOf(fc: number): DataTable {
  switch (fc) {
    case FC.READ_COILS:
    case FC.WRITE_SINGLE_COIL:
    case FC.WRITE_MULTIPLE_COILS:
      return 'coil';
    case FC.READ_DISCRETE_INPUTS:
      return 'discrete';
    case FC.READ_INPUT_REGISTERS:
      return 'input';
    default:
      return 'holding';
  }
}

/** Protocol address (base 0) to the PLC notation on the datasheet. */
export function toPlcAddress(fc: number, address: number): string {
  const prefix = TABLE_PREFIX[tableOf(fc)];
  const oneBased = address + 1;
  // The classic 5-digit form runs out at 9999; beyond that use the 6-digit one.
  const width = oneBased <= 9999 ? 4 : 5;
  return `${prefix}${String(oneBased).padStart(width, '0')}`;
}

/** Formats an address in whichever notation is currently selected. */
export function formatAddress(fc: number, address: number, plcBase1: boolean): string {
  return plcBase1 ? toPlcAddress(fc, address) : String(address);
}

export interface ParsedPlcAddress {
  table: DataTable;
  /** Protocol address, base 0. */
  address: number;
}

/**
 * Parses a PLC-notation address back to a data table and base-0 address.
 * Returns null when the text is not a valid PLC address.
 */
export function fromPlcAddress(text: string): ParsedPlcAddress | null {
  const trimmed = text.trim();
  if (!/^\d{5,6}$/.test(trimmed)) return null;

  const prefix = Number(trimmed[0]);
  const table = (Object.keys(TABLE_PREFIX) as DataTable[]).find(
    (key) => TABLE_PREFIX[key] === prefix,
  );
  if (!table) return null;

  const oneBased = Number(trimmed.slice(1));
  if (oneBased < 1) return null;
  return { table, address: oneBased - 1 };
}
