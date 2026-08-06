import { describe, expect, it } from 'vitest';
import { checkCrc16, crc16, crc16Bytes } from './crc16';

function bytes(...values: number[]): Uint8Array {
  return Uint8Array.from(values);
}

describe('crc16', () => {
  it('matches the CRC-16/MODBUS catalogue check value', () => {
    const input = new TextEncoder().encode('123456789');
    expect(crc16(input)).toBe(0x4b37);
  });

  it('computes the CRC for the canonical read-holding-registers request', () => {
    // 01 03 00 00 00 01 -> CRC transmitted as 84 0A
    const request = bytes(0x01, 0x03, 0x00, 0x00, 0x00, 0x01);
    expect(crc16(request)).toBe(0x0a84);
    expect(crc16Bytes(request)).toEqual([0x84, 0x0a]);
  });

  it('validates a complete frame including its checksum', () => {
    expect(checkCrc16(bytes(0x01, 0x03, 0x00, 0x00, 0x00, 0x01, 0x84, 0x0a))).toBe(true);
  });

  it('rejects a frame with a single corrupted byte', () => {
    expect(checkCrc16(bytes(0x01, 0x03, 0x00, 0x00, 0x00, 0x02, 0x84, 0x0a))).toBe(false);
  });

  it('rejects frames too short to contain a checksum', () => {
    expect(checkCrc16(bytes(0x01, 0x03))).toBe(false);
  });
});
