/**
 * The 29 display formats.
 *
 * 5 native 16-bit renderings, plus 6 wide types (Int32, UInt32, Int64, UInt64,
 * Float32, Float64) in each of 4 word/byte orders.
 *
 * Word order is the single biggest source of "the numbers look like garbage"
 * in the field, so the orders are named after the byte layout they produce:
 *
 *   registers [R0, R1] arrive on the wire as  A B C D
 *     ABCD  big-endian                 A B C D
 *     DCBA  little-endian              D C B A
 *     BADC  big-endian, byte swap      B A D C
 *     CDAB  little-endian, byte swap   C D A B   (word swap — very common)
 */

export type WordOrder = 'ABCD' | 'BADC' | 'CDAB' | 'DCBA';

export const WORD_ORDERS: WordOrder[] = ['ABCD', 'BADC', 'CDAB', 'DCBA'];

export const WORD_ORDER_LABELS: Record<WordOrder, string> = {
  ABCD: 'big-endian',
  BADC: 'big-endian byte swap',
  CDAB: 'little-endian byte swap',
  DCBA: 'little-endian',
};

export type WideKind = 'int32' | 'uint32' | 'int64' | 'uint64' | 'float32' | 'float64';

export type FormatId =
  | 'int16'
  | 'uint16'
  | 'hex16'
  | 'ascii16'
  | 'binary16'
  | `${WideKind}_${WordOrder}`;

export interface FormatSpec {
  id: FormatId;
  label: string;
  /** How many 16-bit registers the format consumes. */
  registerCount: 1 | 2 | 4;
  order: WordOrder | null;
}

const WIDE_LABELS: Record<WideKind, string> = {
  int32: 'Int32',
  uint32: 'UInt32',
  int64: 'Int64',
  uint64: 'UInt64',
  float32: 'Float32',
  float64: 'Float64',
};

const WIDE_REGISTERS: Record<WideKind, 2 | 4> = {
  int32: 2,
  uint32: 2,
  int64: 4,
  uint64: 4,
  float32: 2,
  float64: 4,
};

const NATIVE_FORMATS: FormatSpec[] = [
  { id: 'int16', label: 'Signed', registerCount: 1, order: null },
  { id: 'uint16', label: 'Unsigned', registerCount: 1, order: null },
  { id: 'hex16', label: 'Hex', registerCount: 1, order: null },
  { id: 'ascii16', label: 'ASCII', registerCount: 1, order: null },
  { id: 'binary16', label: 'Binary', registerCount: 1, order: null },
];

/** All 29 formats, in the order they should appear in a picker. */
export const FORMATS: FormatSpec[] = [
  ...NATIVE_FORMATS,
  ...(Object.keys(WIDE_LABELS) as WideKind[]).flatMap((kind) =>
    WORD_ORDERS.map(
      (order): FormatSpec => ({
        id: `${kind}_${order}` as FormatId,
        label: `${WIDE_LABELS[kind]} ${order} (${WORD_ORDER_LABELS[order]})`,
        registerCount: WIDE_REGISTERS[kind],
        order,
      }),
    ),
  ),
];

const FORMAT_BY_ID = new Map(FORMATS.map((f) => [f.id, f]));

export function getFormat(id: FormatId): FormatSpec {
  const spec = FORMAT_BY_ID.get(id);
  if (!spec) throw new RangeError(`Unknown format "${id}"`);
  return spec;
}

export function registerCount(id: FormatId): number {
  return getFormat(id).registerCount;
}

// --- Byte ordering ----------------------------------------------------------

/**
 * Indices into the raw wire bytes that produce a big-endian byte sequence.
 * `result[i]` is the raw byte index that belongs at big-endian position `i`.
 */
export function byteOrderPermutation(order: WordOrder, byteCount: number): number[] {
  const idx: number[] = [];
  switch (order) {
    case 'ABCD':
      for (let i = 0; i < byteCount; i++) idx.push(i);
      break;
    case 'DCBA':
      for (let i = byteCount - 1; i >= 0; i--) idx.push(i);
      break;
    case 'BADC':
      for (let i = 0; i < byteCount; i += 2) idx.push(i + 1, i);
      break;
    case 'CDAB':
      for (let i = byteCount - 2; i >= 0; i -= 2) idx.push(i, i + 1);
      break;
  }
  return idx;
}

function registersToBytes(registers: number[]): Uint8Array {
  const out = new Uint8Array(registers.length * 2);
  for (let i = 0; i < registers.length; i++) {
    out[i * 2] = (registers[i] >>> 8) & 0xff;
    out[i * 2 + 1] = registers[i] & 0xff;
  }
  return out;
}

function bytesToRegisters(bytes: Uint8Array): number[] {
  const out: number[] = [];
  for (let i = 0; i < bytes.length; i += 2) {
    out.push((bytes[i] << 8) | bytes[i + 1]);
  }
  return out;
}

// --- Decoding ---------------------------------------------------------------

export interface Decoded {
  /** Text to show in the grid. */
  text: string;
  /** Numeric value, or null for formats that are not numbers (ASCII). */
  numeric: number | null;
  /** Exact value for 64-bit integers, which do not fit a JS number. */
  big?: bigint;
}

export function decode(registers: number[], id: FormatId): Decoded {
  const spec = getFormat(id);
  if (registers.length < spec.registerCount) {
    throw new RangeError(
      `Format "${id}" needs ${spec.registerCount} register(s), got ${registers.length}`,
    );
  }
  const slice = registers.slice(0, spec.registerCount);
  const raw = slice[0];

  switch (id) {
    case 'int16': {
      const value = raw > 0x7fff ? raw - 0x10000 : raw;
      return { text: String(value), numeric: value };
    }
    case 'uint16':
      return { text: String(raw), numeric: raw };
    case 'hex16':
      return { text: raw.toString(16).toUpperCase().padStart(4, '0'), numeric: raw };
    case 'binary16':
      return { text: raw.toString(2).padStart(16, '0'), numeric: raw };
    case 'ascii16': {
      const hi = (raw >>> 8) & 0xff;
      const lo = raw & 0xff;
      return { text: printableChar(hi) + printableChar(lo), numeric: null };
    }
  }

  const view = orderedView(slice, spec.order as WordOrder);
  const [kind] = id.split('_') as [WideKind, WordOrder];

  switch (kind) {
    case 'int32': {
      const value = view.getInt32(0, false);
      return { text: String(value), numeric: value };
    }
    case 'uint32': {
      const value = view.getUint32(0, false);
      return { text: String(value), numeric: value };
    }
    case 'int64': {
      const big = view.getBigInt64(0, false);
      return { text: big.toString(), numeric: Number(big), big };
    }
    case 'uint64': {
      const big = view.getBigUint64(0, false);
      return { text: big.toString(), numeric: Number(big), big };
    }
    case 'float32': {
      const value = view.getFloat32(0, false);
      return { text: formatFloat(value), numeric: value };
    }
    case 'float64': {
      const value = view.getFloat64(0, false);
      return { text: formatFloat(value), numeric: value };
    }
  }
}

function orderedView(registers: number[], order: WordOrder): DataView {
  const raw = registersToBytes(registers);
  const perm = byteOrderPermutation(order, raw.length);
  const ordered = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) ordered[i] = raw[perm[i]];
  return new DataView(ordered.buffer);
}

function printableChar(byte: number): string {
  return byte >= 0x20 && byte <= 0x7e ? String.fromCharCode(byte) : '.';
}

function formatFloat(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  // Trim float noise without hiding genuinely small values.
  return String(Number(value.toPrecision(9)));
}

// --- Encoding ---------------------------------------------------------------

/**
 * Turns user input into the register values to write.
 * Throws RangeError with a message suitable for showing in a write dialog.
 */
export function encode(input: string, id: FormatId): number[] {
  const spec = getFormat(id);
  const text = input.trim();

  switch (id) {
    case 'int16': {
      const value = parseIntStrict(text, id);
      if (value < -32768 || value > 32767) {
        throw new RangeError('Signed 16-bit value must be -32768..32767');
      }
      return [value & 0xffff];
    }
    case 'uint16': {
      const value = parseIntStrict(text, id);
      if (value < 0 || value > 65535) {
        throw new RangeError('Unsigned 16-bit value must be 0..65535');
      }
      return [value];
    }
    case 'hex16': {
      const value = Number.parseInt(text.replace(/^0x/i, ''), 16);
      if (Number.isNaN(value) || value < 0 || value > 0xffff) {
        throw new RangeError('Hex value must be 0000..FFFF');
      }
      return [value];
    }
    case 'binary16': {
      if (!/^[01]{1,16}$/.test(text)) {
        throw new RangeError('Binary value must be 1..16 digits of 0 or 1');
      }
      return [Number.parseInt(text, 2)];
    }
    case 'ascii16': {
      if (input.length > 2) throw new RangeError('ASCII value must be at most 2 characters');
      const padded = input.padEnd(2, '\0');
      return [(padded.charCodeAt(0) << 8) | padded.charCodeAt(1)];
    }
  }

  const byteCount = spec.registerCount * 2;
  const ordered = new Uint8Array(byteCount);
  const view = new DataView(ordered.buffer);
  const [kind] = id.split('_') as [WideKind, WordOrder];

  switch (kind) {
    case 'int32':
      view.setInt32(0, requireRange(parseIntStrict(text, id), -2147483648, 2147483647), false);
      break;
    case 'uint32':
      view.setUint32(0, requireRange(parseIntStrict(text, id), 0, 4294967295), false);
      break;
    case 'int64':
      view.setBigInt64(0, parseBigIntStrict(text, id), false);
      break;
    case 'uint64': {
      const big = parseBigIntStrict(text, id);
      if (big < 0n) throw new RangeError('Unsigned 64-bit value cannot be negative');
      view.setBigUint64(0, big, false);
      break;
    }
    case 'float32':
      view.setFloat32(0, parseFloatStrict(text, id), false);
      break;
    case 'float64':
      view.setFloat64(0, parseFloatStrict(text, id), false);
      break;
  }

  // Undo the permutation: ordered[i] came from raw[perm[i]].
  const perm = byteOrderPermutation(spec.order as WordOrder, byteCount);
  const raw = new Uint8Array(byteCount);
  for (let i = 0; i < byteCount; i++) raw[perm[i]] = ordered[i];
  return bytesToRegisters(raw);
}

function parseIntStrict(text: string, id: FormatId): number {
  if (!/^[+-]?\d+$/.test(text)) throw new RangeError(`"${text}" is not a valid integer for ${id}`);
  return Number.parseInt(text, 10);
}

function parseBigIntStrict(text: string, id: FormatId): bigint {
  if (!/^[+-]?\d+$/.test(text)) throw new RangeError(`"${text}" is not a valid integer for ${id}`);
  try {
    return BigInt(text);
  } catch {
    throw new RangeError(`"${text}" is out of range for ${id}`);
  }
}

function parseFloatStrict(text: string, id: FormatId): number {
  const value = Number(text);
  if (text === '' || Number.isNaN(value)) {
    throw new RangeError(`"${text}" is not a valid number for ${id}`);
  }
  return value;
}

function requireRange(value: number, min: number, max: number): number {
  if (value < min || value > max) throw new RangeError(`Value must be ${min}..${max}`);
  return value;
}
