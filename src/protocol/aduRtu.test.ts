import { describe, expect, it } from 'vitest';
import { buildRtuFrame, parseRtuFrame } from './aduRtu';
import { ModbusTransportError } from './errors';
import { FC, buildReadRequest } from './pdu';

function bytes(...values: number[]): Uint8Array {
  return Uint8Array.from(values);
}

describe('buildRtuFrame', () => {
  it('produces the canonical frame with the CRC low byte first', () => {
    const pdu = buildReadRequest(FC.READ_HOLDING_REGISTERS, 0, 1);
    expect(buildRtuFrame(0x01, pdu)).toEqual(
      bytes(0x01, 0x03, 0x00, 0x00, 0x00, 0x01, 0x84, 0x0a),
    );
  });

  it('rejects an out-of-range slave ID', () => {
    expect(() => buildRtuFrame(256, bytes(0x03))).toThrow(RangeError);
    expect(() => buildRtuFrame(-1, bytes(0x03))).toThrow(RangeError);
  });
});

describe('parseRtuFrame', () => {
  it('round-trips every supported request', () => {
    const cases = [
      { slaveId: 1, pdu: buildReadRequest(FC.READ_COILS, 0x0013, 10) },
      { slaveId: 17, pdu: buildReadRequest(FC.READ_HOLDING_REGISTERS, 0x006b, 3) },
      { slaveId: 247, pdu: buildReadRequest(FC.READ_INPUT_REGISTERS, 0x0008, 1) },
    ];
    for (const { slaveId, pdu } of cases) {
      const parsed = parseRtuFrame(buildRtuFrame(slaveId, pdu));
      expect(parsed.slaveId).toBe(slaveId);
      expect(Uint8Array.from(parsed.pdu)).toEqual(pdu);
    }
  });

  it('throws CRC_ERROR when a byte is corrupted in transit', () => {
    const frame = buildRtuFrame(0x01, buildReadRequest(FC.READ_HOLDING_REGISTERS, 0, 1));
    frame[3] ^= 0xff;
    expect(() => parseRtuFrame(frame)).toThrow(ModbusTransportError);
    try {
      parseRtuFrame(frame);
    } catch (error) {
      expect((error as ModbusTransportError).code).toBe('CRC_ERROR');
    }
  });

  it('throws SHORT_FRAME on a runt frame', () => {
    try {
      parseRtuFrame(bytes(0x01, 0x03));
      expect.unreachable();
    } catch (error) {
      expect((error as ModbusTransportError).code).toBe('SHORT_FRAME');
    }
  });
});
