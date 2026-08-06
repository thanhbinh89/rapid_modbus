import { describe, expect, it } from 'vitest';
import { buildAsciiFrame, parseAsciiFrame } from './aduAscii';
import { ModbusTransportError } from './errors';
import { FC, buildReadRequest } from './pdu';

const decoder = new TextDecoder();

function asText(frame: Uint8Array): string {
  return decoder.decode(frame);
}

function fromText(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

describe('buildAsciiFrame', () => {
  it('wraps the PDU in ":" ... LRC CRLF', () => {
    const pdu = buildReadRequest(FC.READ_HOLDING_REGISTERS, 0, 1);
    expect(asText(buildAsciiFrame(0x01, pdu))).toBe(':010300000001FB\r\n');
  });

  it('uses uppercase hex', () => {
    const frame = asText(buildAsciiFrame(0xab, Uint8Array.from([0x03, 0xcd])));
    expect(frame).toBe(frame.toUpperCase());
  });
});

describe('parseAsciiFrame', () => {
  it('round-trips a request', () => {
    const pdu = buildReadRequest(FC.READ_HOLDING_REGISTERS, 0x006b, 3);
    const parsed = parseAsciiFrame(buildAsciiFrame(17, pdu));
    expect(parsed.slaveId).toBe(17);
    expect(Uint8Array.from(parsed.pdu)).toEqual(pdu);
  });

  it('accepts a frame without the CRLF terminator', () => {
    const parsed = parseAsciiFrame(fromText(':010300000001FB'));
    expect(parsed.slaveId).toBe(1);
  });

  it('throws LRC_ERROR on a bad checksum', () => {
    try {
      parseAsciiFrame(fromText(':010300000001FF\r\n'));
      expect.unreachable();
    } catch (error) {
      expect((error as ModbusTransportError).code).toBe('LRC_ERROR');
    }
  });

  it('throws MALFORMED_FRAME without the leading colon', () => {
    try {
      parseAsciiFrame(fromText('010300000001FB\r\n'));
      expect.unreachable();
    } catch (error) {
      expect((error as ModbusTransportError).code).toBe('MALFORMED_FRAME');
    }
  });

  it('throws MALFORMED_FRAME on non-hex characters', () => {
    try {
      parseAsciiFrame(fromText(':01030000ZZ01FB\r\n'));
      expect.unreachable();
    } catch (error) {
      expect((error as ModbusTransportError).code).toBe('MALFORMED_FRAME');
    }
  });
});
