/**
 * Modbus PDU construction and parsing.
 *
 * A PDU is the function code plus its data — no slave ID, no checksum. The
 * ADU layers (RTU/ASCII) wrap it.
 *
 * Supported: 01, 02, 03, 04 (read) and 05, 06, 15, 16 (write).
 */

import { ModbusExceptionError, ModbusTransportError } from './errors';

export const FC = {
  READ_COILS: 0x01,
  READ_DISCRETE_INPUTS: 0x02,
  READ_HOLDING_REGISTERS: 0x03,
  READ_INPUT_REGISTERS: 0x04,
  WRITE_SINGLE_COIL: 0x05,
  WRITE_SINGLE_REGISTER: 0x06,
  WRITE_MULTIPLE_COILS: 0x0f,
  WRITE_MULTIPLE_REGISTERS: 0x10,
} as const;

export type FunctionCode = (typeof FC)[keyof typeof FC];

export const SUPPORTED_FUNCTION_CODES: FunctionCode[] = [
  FC.READ_COILS,
  FC.READ_DISCRETE_INPUTS,
  FC.READ_HOLDING_REGISTERS,
  FC.READ_INPUT_REGISTERS,
  FC.WRITE_SINGLE_COIL,
  FC.WRITE_SINGLE_REGISTER,
  FC.WRITE_MULTIPLE_COILS,
  FC.WRITE_MULTIPLE_REGISTERS,
];

export const FUNCTION_LABELS: Record<FunctionCode, string> = {
  [FC.READ_COILS]: '01: Read Coils',
  [FC.READ_DISCRETE_INPUTS]: '02: Read Discrete Inputs',
  [FC.READ_HOLDING_REGISTERS]: '03: Read Holding Registers',
  [FC.READ_INPUT_REGISTERS]: '04: Read Input Registers',
  [FC.WRITE_SINGLE_COIL]: '05: Write Single Coil',
  [FC.WRITE_SINGLE_REGISTER]: '06: Write Single Register',
  [FC.WRITE_MULTIPLE_COILS]: '15: Write Multiple Coils',
  [FC.WRITE_MULTIPLE_REGISTERS]: '16: Write Multiple Registers',
};

/** Per-function quantity limits, straight from the Modbus spec. */
export const QUANTITY_LIMITS: Record<number, { min: number; max: number }> = {
  [FC.READ_COILS]: { min: 1, max: 2000 },
  [FC.READ_DISCRETE_INPUTS]: { min: 1, max: 2000 },
  [FC.READ_HOLDING_REGISTERS]: { min: 1, max: 125 },
  [FC.READ_INPUT_REGISTERS]: { min: 1, max: 125 },
  [FC.WRITE_MULTIPLE_COILS]: { min: 1, max: 1968 },
  [FC.WRITE_MULTIPLE_REGISTERS]: { min: 1, max: 123 },
};

export function isBitFunction(fc: number): boolean {
  return (
    fc === FC.READ_COILS ||
    fc === FC.READ_DISCRETE_INPUTS ||
    fc === FC.WRITE_SINGLE_COIL ||
    fc === FC.WRITE_MULTIPLE_COILS
  );
}

export function isReadFunction(fc: number): boolean {
  return fc >= FC.READ_COILS && fc <= FC.READ_INPUT_REGISTERS;
}

// --- Request builders -------------------------------------------------------

function assertAddress(address: number): void {
  if (!Number.isInteger(address) || address < 0 || address > 0xffff) {
    throw new RangeError(`Address must be 0..65535, got ${address}`);
  }
}

function assertQuantity(fc: number, quantity: number): void {
  const limit = QUANTITY_LIMITS[fc];
  if (!limit) return;
  if (!Number.isInteger(quantity) || quantity < limit.min || quantity > limit.max) {
    throw new RangeError(
      `Quantity for function ${fc} must be ${limit.min}..${limit.max}, got ${quantity}`,
    );
  }
}

function be16(value: number): [number, number] {
  return [(value >>> 8) & 0xff, value & 0xff];
}

/** Functions 01–04. */
export function buildReadRequest(fc: number, address: number, quantity: number): Uint8Array {
  if (!isReadFunction(fc)) throw new RangeError(`Not a read function code: ${fc}`);
  assertAddress(address);
  assertQuantity(fc, quantity);
  return Uint8Array.from([fc, ...be16(address), ...be16(quantity)]);
}

/** Function 05. */
export function buildWriteSingleCoil(address: number, on: boolean): Uint8Array {
  assertAddress(address);
  return Uint8Array.from([FC.WRITE_SINGLE_COIL, ...be16(address), on ? 0xff : 0x00, 0x00]);
}

/** Function 06. */
export function buildWriteSingleRegister(address: number, value: number): Uint8Array {
  assertAddress(address);
  if (!Number.isInteger(value) || value < 0 || value > 0xffff) {
    throw new RangeError(`Register value must be 0..65535, got ${value}`);
  }
  return Uint8Array.from([FC.WRITE_SINGLE_REGISTER, ...be16(address), ...be16(value)]);
}

/** Function 15. Coils are packed LSB-first, low address in bit 0. */
export function buildWriteMultipleCoils(address: number, coils: boolean[]): Uint8Array {
  assertAddress(address);
  assertQuantity(FC.WRITE_MULTIPLE_COILS, coils.length);
  const byteCount = Math.ceil(coils.length / 8);
  const data = new Uint8Array(byteCount);
  coils.forEach((on, i) => {
    if (on) data[i >> 3] |= 1 << i % 8;
  });
  return Uint8Array.from([
    FC.WRITE_MULTIPLE_COILS,
    ...be16(address),
    ...be16(coils.length),
    byteCount,
    ...data,
  ]);
}

/** Function 16. */
export function buildWriteMultipleRegisters(address: number, values: number[]): Uint8Array {
  assertAddress(address);
  assertQuantity(FC.WRITE_MULTIPLE_REGISTERS, values.length);
  const data: number[] = [];
  for (const value of values) {
    if (!Number.isInteger(value) || value < 0 || value > 0xffff) {
      throw new RangeError(`Register value must be 0..65535, got ${value}`);
    }
    data.push(...be16(value));
  }
  return Uint8Array.from([
    FC.WRITE_MULTIPLE_REGISTERS,
    ...be16(address),
    ...be16(values.length),
    data.length,
    ...data,
  ]);
}

// --- Response parsing -------------------------------------------------------

export type ReadResult =
  | { kind: 'bits'; values: boolean[] }
  | { kind: 'registers'; values: number[] };

export type WriteEcho = { address: number; value: number };

/**
 * Throws ModbusExceptionError when the device returned an exception PDU.
 * Callers should run this before any function-specific parsing.
 */
export function assertNotException(pdu: Uint8Array, requestFc: number): void {
  if (pdu.length < 1) {
    throw new ModbusTransportError('SHORT_FRAME', 'empty PDU');
  }
  const fc = pdu[0];
  if ((fc & 0x80) !== 0) {
    if (pdu.length < 2) {
      throw new ModbusTransportError('SHORT_FRAME', 'exception PDU missing code');
    }
    throw new ModbusExceptionError(fc & 0x7f, pdu[1]);
  }
  if (fc !== requestFc) {
    throw new ModbusTransportError(
      'FUNCTION_MISMATCH',
      `expected ${requestFc}, got ${fc}`,
    );
  }
}

/** Parses a response to functions 01–04. `quantity` is what was requested. */
export function parseReadResponse(
  pdu: Uint8Array,
  requestFc: number,
  quantity: number,
): ReadResult {
  assertNotException(pdu, requestFc);
  if (pdu.length < 2) {
    throw new ModbusTransportError('SHORT_FRAME', 'missing byte count');
  }
  const byteCount = pdu[1];
  const data = pdu.subarray(2);
  if (data.length !== byteCount) {
    throw new ModbusTransportError(
      'BYTE_COUNT_MISMATCH',
      `header says ${byteCount}, got ${data.length}`,
    );
  }

  if (isBitFunction(requestFc)) {
    const expected = Math.ceil(quantity / 8);
    if (byteCount !== expected) {
      throw new ModbusTransportError(
        'BYTE_COUNT_MISMATCH',
        `expected ${expected} bytes for ${quantity} bits, got ${byteCount}`,
      );
    }
    const values: boolean[] = [];
    for (let i = 0; i < quantity; i++) {
      values.push((data[i >> 3] & (1 << i % 8)) !== 0);
    }
    return { kind: 'bits', values };
  }

  if (byteCount !== quantity * 2) {
    throw new ModbusTransportError(
      'BYTE_COUNT_MISMATCH',
      `expected ${quantity * 2} bytes for ${quantity} registers, got ${byteCount}`,
    );
  }
  const values: number[] = [];
  for (let i = 0; i < quantity; i++) {
    values.push((data[i * 2] << 8) | data[i * 2 + 1]);
  }
  return { kind: 'registers', values };
}

/**
 * Parses a response to functions 05, 06, 15 or 16.
 * All four echo an address and a value (or quantity) in the same layout.
 */
export function parseWriteResponse(pdu: Uint8Array, requestFc: number): WriteEcho {
  assertNotException(pdu, requestFc);
  if (pdu.length < 5) {
    throw new ModbusTransportError('SHORT_FRAME', `write response is ${pdu.length} bytes`);
  }
  return {
    address: (pdu[1] << 8) | pdu[2],
    value: (pdu[3] << 8) | pdu[4],
  };
}
