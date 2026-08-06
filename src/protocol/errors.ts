/**
 * Modbus exception codes and transport-level failures.
 *
 * Field diagnostics live or die on error messages, so every failure carries a
 * stable machine code plus a hint about what to actually check on site.
 */

export const EXCEPTION_CODES = {
  0x01: 'Illegal function',
  0x02: 'Illegal data address',
  0x03: 'Illegal data value',
  0x04: 'Server device failure',
  0x05: 'Acknowledge',
  0x06: 'Server device busy',
  0x08: 'Memory parity error',
  0x0a: 'Gateway path unavailable',
  0x0b: 'Gateway target device failed to respond',
} as const;

/** What to check on site when a given exception comes back. */
export const EXCEPTION_HINTS: Record<number, string> = {
  0x01: 'The device does not implement this function code. Try 03 vs 04.',
  0x02: 'Address out of range. Check base-0 vs base-1 (4xxxx) addressing.',
  0x03: 'Quantity or written value out of range for this register.',
  0x04: 'Unrecoverable error inside the device.',
  0x05: 'Request accepted, still processing. Poll again.',
  0x06: 'Device busy. Slow the scan rate down.',
  0x08: 'Memory parity error in the device.',
  0x0a: 'Gateway misconfigured — no path to the target device.',
  0x0b: 'Gateway reached, but the target device did not answer.',
};

export function exceptionText(code: number): string {
  return (
    (EXCEPTION_CODES as Record<number, string>)[code] ??
    `Unknown exception 0x${code.toString(16).padStart(2, '0')}`
  );
}

export type TransportErrorCode =
  | 'TIMEOUT'
  | 'CRC_ERROR'
  | 'LRC_ERROR'
  | 'SHORT_FRAME'
  | 'MALFORMED_FRAME'
  | 'SLAVE_MISMATCH'
  | 'FUNCTION_MISMATCH'
  | 'BYTE_COUNT_MISMATCH'
  | 'PORT_CLOSED';

export const TRANSPORT_HINTS: Record<TransportErrorCode, string> = {
  TIMEOUT: 'No response. Check slave ID, baud rate, parity and A/B wiring.',
  CRC_ERROR: 'CRC mismatch — usually a baud rate or parity mismatch, or line noise.',
  LRC_ERROR: 'LRC mismatch — check the ASCII framing settings.',
  SHORT_FRAME: 'Response shorter than expected. Raise the response timeout.',
  MALFORMED_FRAME: 'Response could not be parsed. Confirm RTU vs ASCII mode.',
  SLAVE_MISMATCH: 'Another slave answered. Two devices may share the same ID.',
  FUNCTION_MISMATCH: 'Function code in the response does not match the request.',
  BYTE_COUNT_MISMATCH: 'Byte count does not match the requested quantity.',
  PORT_CLOSED: 'The serial port is closed. Reconnect the adapter.',
};

/** A Modbus exception response (the device answered, and said no). */
export class ModbusExceptionError extends Error {
  readonly kind = 'exception' as const;
  readonly functionCode: number;
  readonly exceptionCode: number;

  constructor(functionCode: number, exceptionCode: number) {
    super(`Modbus exception ${exceptionCode}: ${exceptionText(exceptionCode)}`);
    this.name = 'ModbusExceptionError';
    this.functionCode = functionCode;
    this.exceptionCode = exceptionCode;
  }

  get hint(): string {
    return EXCEPTION_HINTS[this.exceptionCode] ?? '';
  }
}

/** A transport or framing failure (the device did not answer usably). */
export class ModbusTransportError extends Error {
  readonly kind = 'transport' as const;
  readonly code: TransportErrorCode;

  constructor(code: TransportErrorCode, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'ModbusTransportError';
    this.code = code;
  }

  get hint(): string {
    return TRANSPORT_HINTS[this.code] ?? '';
  }
}
