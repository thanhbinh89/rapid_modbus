/**
 * Device profiles: a reusable register map for a device model.
 *
 * The same meter, drive or controller gets commissioned over and over. Import
 * the profile once and the grid reads "Voltage L1  231.4 V" instead of
 * "40001  2314" — which is the difference between reading a panel and
 * decoding one.
 *
 * Two input shapes are accepted, because both turn up in practice:
 *   JSON  a complete profile that can create a definition outright
 *   CSV   just the register table, applied to the definition you are on
 */

import { FORMATS } from '../protocol/formats';
import type { FormatId } from '../protocol/formats';
import type { ReadFunctionCode } from '../core/scheduler';
import type { Definition, DisplayConfig, RowConfig } from '../store/types';
import { defaultDisplay } from '../store/types';
import { fromPlcAddress, tableOf } from './plcAddress';

export const PROFILE_VERSION = 1;

export interface ProfileRegister {
  /** Protocol address, base 0. */
  address: number;
  name: string;
  format?: FormatId;
  /** Engineering value = factor x raw + offset. */
  factor?: number;
  offset?: number;
  unit?: string;
}

export interface DeviceProfile {
  version: number;
  device: string;
  slaveId?: number;
  fc?: ReadFunctionCode;
  /** Start address of the block the registers live in. */
  address?: number;
  quantity?: number;
  defaultFormat?: FormatId;
  registers: ProfileRegister[];
}

export class ProfileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProfileError';
  }
}

const FORMAT_IDS = new Set<string>(FORMATS.map((f) => f.id));
const READ_FCS = new Set<number>([1, 2, 3, 4]);

// --- Parsing ----------------------------------------------------------------

/** Sniffs JSON vs CSV so the operator does not have to say which they have. */
export function parseProfile(text: string): DeviceProfile {
  const trimmed = text.trim();
  if (!trimmed) throw new ProfileError('The file is empty.');

  if (trimmed.startsWith('{')) return parseProfileJson(trimmed);
  return { version: PROFILE_VERSION, device: 'Imported', registers: parseProfileCsv(trimmed) };
}

export function parseProfileJson(text: string): DeviceProfile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ProfileError('Not valid JSON.');
  }
  if (!isRecord(raw)) throw new ProfileError('A profile must be a JSON object.');

  const version = Number(raw.version ?? PROFILE_VERSION);
  if (version > PROFILE_VERSION) {
    throw new ProfileError(
      `This profile was written for a newer version (v${version}). Update rapid_modbus first.`,
    );
  }
  if (!Array.isArray(raw.registers)) {
    throw new ProfileError('A profile needs a "registers" array.');
  }

  const fc = Number(raw.fc);
  return {
    version: PROFILE_VERSION,
    device: typeof raw.device === 'string' && raw.device ? raw.device : 'Imported',
    slaveId: inRange(raw.slaveId, 0, 255),
    fc: READ_FCS.has(fc) ? (fc as ReadFunctionCode) : undefined,
    address: inRange(raw.address, 0, 65535),
    quantity: inRange(raw.quantity, 1, 2000),
    defaultFormat: isFormatId(raw.defaultFormat) ? raw.defaultFormat : undefined,
    registers: raw.registers.map((entry, index) => readRegister(entry, index)),
  };
}

/**
 * Columns are matched by header name, so the column order does not matter.
 * Address may be given base-0 as `address` or in datasheet notation as
 * `plc_address` — guessing between the two would silently read the wrong
 * register, so the header has to say which it is.
 */
export function parseProfileCsv(text: string): ProfileRegister[] {
  const rows = parseCsv(text);
  if (rows.length < 2) throw new ProfileError('The CSV needs a header row and at least one row.');

  const header = rows[0].map((cell) => cell.trim().toLowerCase().replace(/[\s-]+/g, '_'));
  const column = (...names: string[]) => {
    for (const name of names) {
      const index = header.indexOf(name);
      if (index !== -1) return index;
    }
    return -1;
  };

  const addressColumn = column('address', 'addr', 'register');
  const plcColumn = column('plc_address', 'plc');
  if (addressColumn === -1 && plcColumn === -1) {
    throw new ProfileError('The CSV needs an "address" (base 0) or "plc_address" (4xxxx) column.');
  }

  const nameColumn = column('name', 'label', 'description');
  const formatColumn = column('format', 'type');
  const factorColumn = column('factor', 'scale', 'multiplier');
  const offsetColumn = column('offset', 'bias');
  const unitColumn = column('unit', 'units');

  const registers: ProfileRegister[] = [];
  for (let line = 1; line < rows.length; line++) {
    const cells = rows[line];
    if (cells.every((cell) => cell.trim() === '')) continue;

    const address = readAddress(cells, addressColumn, plcColumn, line);
    const register: ProfileRegister = {
      address,
      name: nameColumn === -1 ? '' : (cells[nameColumn] ?? '').trim(),
    };

    const format = formatColumn === -1 ? undefined : (cells[formatColumn] ?? '').trim();
    if (format && !FORMAT_IDS.has(format)) {
      throw new ProfileError(`Row ${line + 1}: "${format}" is not a known format.`);
    }
    if (format) register.format = format as FormatId;

    // Identity scaling carries no information, so drop it here the same way
    // the JSON reader does. `applyProfile` defaults factor to 1 anyway.
    const factor = numberOrUndefined(cells[factorColumn]);
    if (factor !== undefined && factor !== 0 && factor !== 1) register.factor = factor;
    const offset = numberOrUndefined(cells[offsetColumn]);
    if (offset !== undefined && offset !== 0) register.offset = offset;

    const unit = unitColumn === -1 ? '' : (cells[unitColumn] ?? '').trim();
    if (unit) register.unit = unit;

    registers.push(register);
  }

  if (registers.length === 0) throw new ProfileError('No register rows found.');
  return registers;
}

function readAddress(
  cells: string[],
  addressColumn: number,
  plcColumn: number,
  line: number,
): number {
  if (addressColumn !== -1) {
    const value = Number((cells[addressColumn] ?? '').trim());
    if (!Number.isInteger(value) || value < 0 || value > 65535) {
      throw new ProfileError(`Row ${line + 1}: address must be an integer 0–65535.`);
    }
    return value;
  }
  const text = (cells[plcColumn] ?? '').trim();
  const parsed = fromPlcAddress(text);
  if (!parsed) throw new ProfileError(`Row ${line + 1}: "${text}" is not a PLC address.`);
  return parsed.address;
}

function readRegister(raw: unknown, index: number): ProfileRegister {
  if (!isRecord(raw)) throw new ProfileError(`Register ${index + 1} is not an object.`);

  const address = Number(raw.address);
  if (!Number.isInteger(address) || address < 0 || address > 65535) {
    throw new ProfileError(`Register ${index + 1}: address must be an integer 0–65535.`);
  }

  const register: ProfileRegister = {
    address,
    name: typeof raw.name === 'string' ? raw.name : '',
  };
  if (isFormatId(raw.format)) register.format = raw.format;

  const factor = Number(raw.factor);
  if (Number.isFinite(factor) && factor !== 0 && factor !== 1) register.factor = factor;
  const offset = Number(raw.offset);
  if (Number.isFinite(offset) && offset !== 0) register.offset = offset;
  if (typeof raw.unit === 'string' && raw.unit) register.unit = raw.unit;

  return register;
}

// --- Applying ---------------------------------------------------------------

/**
 * Maps a profile's absolute addresses onto a definition's row offsets.
 * Registers outside the definition's range are reported rather than dropped —
 * silently ignoring half a profile is how people end up reading the wrong
 * block and not noticing.
 */
export function applyProfile(
  definition: Definition,
  profile: DeviceProfile,
): { display: DisplayConfig; applied: number; skipped: ProfileRegister[] } {
  const rows: Record<number, RowConfig> = { ...definition.display.rows };
  const skipped: ProfileRegister[] = [];
  let applied = 0;

  for (const register of profile.registers) {
    const offset = register.address - definition.address;
    if (offset < 0 || offset >= definition.quantity) {
      skipped.push(register);
      continue;
    }

    const config: RowConfig = { ...rows[offset] };
    if (register.name) config.name = register.name;
    if (register.format) config.format = register.format;
    if (register.unit) config.unit = register.unit;
    if (register.factor !== undefined || register.offset !== undefined) {
      config.scaling = { factor: register.factor ?? 1, offset: register.offset ?? 0 };
    }
    rows[offset] = config;
    applied++;
  }

  return {
    display: {
      ...definition.display,
      defaultFormat: profile.defaultFormat ?? definition.display.defaultFormat,
      rows,
    },
    applied,
    skipped,
  };
}

/** Builds a whole definition from a profile that carries the block layout. */
export function profileToDefinition(profile: DeviceProfile, id: string): Definition {
  const fc = profile.fc ?? 3;
  const addresses = profile.registers.map((register) => register.address);
  const start = profile.address ?? (addresses.length > 0 ? Math.min(...addresses) : 0);
  const end = addresses.length > 0 ? Math.max(...addresses) : start;
  const span = profile.quantity ?? Math.max(1, end - start + 1);
  const maxQuantity = fc === 1 || fc === 2 ? 2000 : 125;

  const base: Definition = {
    id,
    name: profile.device,
    slaveId: profile.slaveId ?? 1,
    fc,
    address: start,
    quantity: Math.min(span, maxQuantity),
    scanRateMs: 1000,
    enabled: true,
    disableOnError: false,
    display: { ...defaultDisplay(), defaultFormat: profile.defaultFormat ?? 'uint16' },
  };

  return { ...base, display: applyProfile(base, profile).display };
}

/** Exports the current definition so the same map can be reused next time. */
export function definitionToProfile(definition: Definition): DeviceProfile {
  const registers: ProfileRegister[] = [];

  for (const [key, config] of Object.entries(definition.display.rows)) {
    const offset = Number(key);
    if (!config.name && !config.format && !config.unit && !config.scaling) continue;

    const register: ProfileRegister = {
      address: definition.address + offset,
      name: config.name ?? '',
    };
    if (config.format) register.format = config.format;
    if (config.unit) register.unit = config.unit;
    if (config.scaling) {
      register.factor = config.scaling.factor;
      register.offset = config.scaling.offset;
    }
    registers.push(register);
  }

  registers.sort((a, b) => a.address - b.address);

  return {
    version: PROFILE_VERSION,
    device: definition.name,
    slaveId: definition.slaveId,
    fc: definition.fc,
    address: definition.address,
    quantity: definition.quantity,
    defaultFormat: definition.display.defaultFormat,
    registers,
  };
}

export function serializeProfile(profile: DeviceProfile): string {
  return JSON.stringify(profile, null, 2);
}

// --- CSV --------------------------------------------------------------------

/** Minimal RFC 4180 reader: quoted fields, doubled quotes, CRLF or LF. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }

  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export function profileToCsv(profile: DeviceProfile, fc: number, plcBase1: boolean): string {
  const prefix = { coil: 0, discrete: 1, input: 3, holding: 4 }[tableOf(fc)];
  const header = plcBase1
    ? ['plc_address', 'name', 'format', 'factor', 'offset', 'unit']
    : ['address', 'name', 'format', 'factor', 'offset', 'unit'];

  const escape = (value: string) => (/[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);

  const lines = [header.join(',')];
  for (const register of profile.registers) {
    const oneBased = register.address + 1;
    const address = plcBase1
      ? `${prefix}${String(oneBased).padStart(oneBased <= 9999 ? 4 : 5, '0')}`
      : String(register.address);
    lines.push(
      [
        address,
        escape(register.name),
        register.format ?? '',
        register.factor ?? '',
        register.offset ?? '',
        escape(register.unit ?? ''),
      ].join(','),
    );
  }
  return lines.join('\n');
}

// --- Helpers ----------------------------------------------------------------

function isFormatId(value: unknown): value is FormatId {
  return typeof value === 'string' && FORMAT_IDS.has(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function inRange(raw: unknown, min: number, max: number): number | undefined {
  const value = Number(raw);
  if (!Number.isFinite(value)) return undefined;
  return value >= min && value <= max ? Math.round(value) : undefined;
}

function numberOrUndefined(cell: string | undefined): number | undefined {
  if (cell === undefined) return undefined;
  const trimmed = cell.trim();
  if (trimmed === '') return undefined;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : undefined;
}
