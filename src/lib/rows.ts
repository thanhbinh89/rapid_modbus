/**
 * Turning a definition's raw response into the rows shown in the grid.
 *
 * Wide formats span several registers, so a 10-register read displayed as
 * Float32 produces 5 rows, not 10. Scaling, units, value names and colour
 * rules are applied here too, so the grid component stays a rendering concern.
 */

import type { Decoded, FormatId } from '../protocol/formats';
import { decode, registerCount } from '../protocol/formats';
import type {
  ColorRule,
  ConditionalColor,
  Definition,
  DefinitionState,
  RowConfig,
  Scaling,
} from '../store/types';
import { isIdentityScaling } from '../store/types';
import { formatNumber } from './number';

export interface GridRow {
  /** Offset from the definition's start address. */
  offset: number;
  address: number;
  name: string;
  format: FormatId;
  /** Null when the value could not be decoded, or nothing has been read yet. */
  decoded: Decoded | null;
  /** Engineering value after scaling; equals the raw value when unscaled. */
  scaled: number | null;
  unit: string;
  scaling: Scaling | undefined;
  /** What the cell shows: a value name, or the scaled value plus its unit. */
  text: string;
  /** Set when a colour rule matches the scaled value. */
  color: ConditionalColor | null;
  /** Raw registers backing this row, for the write dialog. */
  registers: number[] | null;
  /** Set for bit tables (coils, discrete inputs). */
  bit: boolean | null;
}

export function rowConfig(definition: Definition, offset: number): RowConfig {
  return definition.display.rows[offset] ?? {};
}

export function formatFor(definition: Definition, offset: number): FormatId {
  return rowConfig(definition, offset).format ?? definition.display.defaultFormat;
}

export function applyScaling(raw: number, scaling: Scaling | undefined): number {
  if (isIdentityScaling(scaling)) return raw;
  return scaling!.factor * raw + scaling!.offset;
}

/** Inverse of applyScaling, for turning an entered value back into registers. */
export function removeScaling(engineering: number, scaling: Scaling | undefined): number {
  if (isIdentityScaling(scaling)) return engineering;
  return (engineering - scaling!.offset) / scaling!.factor;
}

export function matchColor(value: number | null, rules: ColorRule[]): ConditionalColor | null {
  if (value === null) return null;
  // First match wins, so ordering the list is how an operator expresses
  // precedence between overlapping bands.
  for (const rule of rules) {
    if (value >= rule.min && value <= rule.max) return rule.color;
  }
  return null;
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
  const { valueNames, colorRules } = definition.display;
  const rows: GridRow[] = [];

  for (let offset = 0; offset < definition.quantity; offset++) {
    const config = rowConfig(definition, offset);
    const bit = values?.[offset] ?? null;
    const numeric = bit === null ? null : bit ? 1 : 0;
    const decoded: Decoded | null =
      numeric === null ? null : { text: String(numeric), numeric };

    rows.push({
      offset,
      address: definition.address + offset,
      name: config.name ?? '',
      format: 'uint16',
      decoded,
      scaled: numeric,
      unit: config.unit ?? '',
      scaling: undefined,
      text: displayText(numeric, numeric, config, valueNames, decoded),
      color: matchColor(numeric, colorRules),
      registers: null,
      bit,
    });
  }
  return rows;
}

function buildRegisterRows(definition: Definition, values: number[] | null): GridRow[] {
  const { valueNames, colorRules } = definition.display;
  const rows: GridRow[] = [];
  let offset = 0;

  while (offset < definition.quantity) {
    const config = rowConfig(definition, offset);
    const format = config.format ?? definition.display.defaultFormat;
    const width = registerCount(format);

    // A wide format at the tail of the range has nothing to sit on.
    if (offset + width > definition.quantity) {
      rows.push(emptyRow(definition, offset, format, config));
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

    const raw = decoded?.numeric ?? null;
    const scaled = raw === null ? null : applyScaling(raw, config.scaling);

    rows.push({
      offset,
      address: definition.address + offset,
      name: config.name ?? '',
      format,
      decoded,
      scaled,
      unit: config.unit ?? '',
      scaling: config.scaling,
      text: displayText(raw, scaled, config, valueNames, decoded),
      color: matchColor(scaled, colorRules),
      registers,
      bit: null,
    });
    offset += width;
  }
  return rows;
}

/**
 * A value name beats everything — "Fault" is more use than "2". Otherwise show
 * the scaled number, falling back to the format's own text so that ASCII, hex
 * and binary keep rendering as themselves.
 */
function displayText(
  raw: number | null,
  scaled: number | null,
  config: RowConfig,
  valueNames: Record<number, string>,
  decoded: Decoded | null,
): string {
  if (!decoded) return '';

  if (raw !== null && Number.isInteger(raw)) {
    const label = valueNames[raw];
    if (label !== undefined) return label;
  }

  const unit = config.unit ? ` ${config.unit}` : '';

  if (scaled !== null && !isIdentityScaling(config.scaling)) {
    return formatNumber(scaled) + unit;
  }
  return decoded.text + unit;
}

function emptyRow(
  definition: Definition,
  offset: number,
  format: FormatId,
  config: RowConfig,
): GridRow {
  return {
    offset,
    address: definition.address + offset,
    name: config.name ?? '',
    format,
    decoded: null,
    scaled: null,
    unit: config.unit ?? '',
    scaling: config.scaling,
    text: '',
    color: null,
    registers: null,
    bit: null,
  };
}
