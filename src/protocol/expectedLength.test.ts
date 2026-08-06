import { describe, expect, it } from 'vitest';
import { expectedRtuResponseLength, t35Millis } from './expectedLength';
import { FC } from './pdu';

function bytes(...values: number[]): Uint8Array {
  return Uint8Array.from(values);
}

describe('expectedRtuResponseLength', () => {
  it('needs at least the address and function code', () => {
    expect(expectedRtuResponseLength(bytes(), FC.READ_HOLDING_REGISTERS)).toBeNull();
    expect(expectedRtuResponseLength(bytes(0x01), FC.READ_HOLDING_REGISTERS)).toBeNull();
  });

  it('returns 5 for any exception response, whatever was requested', () => {
    for (const fc of [FC.READ_COILS, FC.READ_HOLDING_REGISTERS, FC.WRITE_MULTIPLE_REGISTERS]) {
      expect(expectedRtuResponseLength(bytes(0x01, fc | 0x80), fc)).toBe(5);
    }
  });

  it('waits for the byte count on read functions', () => {
    expect(expectedRtuResponseLength(bytes(0x01, 0x03), FC.READ_HOLDING_REGISTERS)).toBeNull();
  });

  it('derives the length from the byte count on read functions', () => {
    // addr + fc + byteCount + data + 2 CRC
    expect(expectedRtuResponseLength(bytes(0x01, 0x03, 0x06), FC.READ_HOLDING_REGISTERS)).toBe(11);
    expect(expectedRtuResponseLength(bytes(0x01, 0x01, 0x01), FC.READ_COILS)).toBe(6);
    expect(expectedRtuResponseLength(bytes(0x01, 0x04, 0xfa), FC.READ_INPUT_REGISTERS)).toBe(255);
  });

  it('returns the fixed 8 bytes for write functions', () => {
    for (const fc of [
      FC.WRITE_SINGLE_COIL,
      FC.WRITE_SINGLE_REGISTER,
      FC.WRITE_MULTIPLE_COILS,
      FC.WRITE_MULTIPLE_REGISTERS,
    ]) {
      expect(expectedRtuResponseLength(bytes(0x01, fc), fc)).toBe(8);
    }
  });

  it('returns null for an unsupported function code', () => {
    expect(expectedRtuResponseLength(bytes(0x01, 0x2b), 0x2b)).toBeNull();
  });
});

describe('t35Millis', () => {
  it('is fixed at 1.75 ms at and above 19200 baud', () => {
    expect(t35Millis(19200)).toBe(1.75);
    expect(t35Millis(115200)).toBe(1.75);
  });

  it('scales with the character time below 19200 baud', () => {
    // 11 bits * 3.5 chars / 9600 baud = ~4.01 ms
    expect(t35Millis(9600)).toBeCloseTo(4.010, 3);
    expect(t35Millis(1200)).toBeCloseTo(32.083, 3);
  });
});
