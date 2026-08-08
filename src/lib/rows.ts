/**
 * Turning a definition's raw response into the rows shown in the grid.
 *
 * Wide formats span several registers, so a 10-register read displayed as
 * Float32 produces 5 rows, not 10. Keeping that arithmetic here means the grid
 * component stays a rendering concern.
 */

import type { Decoded, FormatId } from '../protocol/formats';
import { decode, registerCount } from '../protocol/formats';
import type { Definition, DefinitionState } from '../store/types';

export interface GridRow {
  /** Offset from the definition's start address. */
  offset: number;
  address: number;
  name: string;
  format: FormatId;
  /** Null when the value could not be decoded, or nothing has been read yet. */
  decoded: Decoded | null;
  /** Raw registers backing this row, for the write dialog. */
  registers: number[] | null;
  /** Set for bit tables (coils, discrete inputs). */
  bit: boolean | null;
}

export function formatFor(definition: Definition, offset: number): FormatId {
  return definition.display.formats[offset] ?? definition.display.defaultFormat;
}

export function buildRows(definition: Definition, state: DefinitionState): GridRow[] {
  const values = state.values;
  const isBits = Array.isArray(values) && typeof values[0] === 'boolean';

  if (isBits || isBitDefinition(definition)) {
    return buildBitRows(definition, values as boolean[] | null);
  }
  return buildRegisterRows(definition, values as number[] | null);
}

function isBitDefinition(definition: Definition): boolean {
  return definition.fc === 1 || definition.fc === 2;
}

function buildBitRows(definition: Definition, values: boolean[] | null): GridRow[] {
  const rows: GridRow[] = [];
  for (let offset = 0; offset < definition.quantity; offset++) {
    const bit = values?.[offset] ?? null;
    rows.push({
      offset,
      address: definition.address + offset,
      name: definition.display.names[offset] ?? '',
      format: 'uint16',
      decoded: bit === null ? null : { text: bit ? '1' : '0', numeric: bit ? 1 : 0 },
      registers: null,
      bit,
    });
  }
  return rows;
}

function buildRegisterRows(definition: Definition, values: number[] | null): GridRow[] {
  const rows: GridRow[] = [];
  let offset = 0;

  while (offset < definition.quantity) {
    const format = formatFor(definition, offset);
    const width = registerCount(format);

    // A wide format at the tail of the range has nothing to sit on.
    if (offset + width > definition.quantity) {
      rows.push(emptyRow(definition, offset, format));
      offset += 1;
      continue;
    }

    const registers = values ? values.slice(offset, offset + width) : null;
    let decoded: Decoded | null = null;
    if (registers && registers.length === width) {
      try {
        decoded = decode(registers, format);
      } catch {
        decoded = null;
      }
    }

    rows.push({
      offset,
      address: definition.address + offset,
      name: definition.display.names[offset] ?? '',
      format,
      decoded,
      registers,
      bit: null,
    });
    offset += width;
  }
  return rows;
}

function emptyRow(definition: Definition, offset: number, format: FormatId): GridRow {
  return {
    offset,
    address: definition.address + offset,
    name: definition.display.names[offset] ?? '',
    format,
    decoded: null,
    registers: null,
    bit: null,
  };
}
