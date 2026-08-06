import { describe, expect, it } from 'vitest';
import { ModbusExceptionError, ModbusTransportError } from './errors';
import {
  FC,
  buildReadRequest,
  buildWriteMultipleCoils,
  buildWriteMultipleRegisters,
  buildWriteSingleCoil,
  buildWriteSingleRegister,
  parseReadResponse,
  parseWriteResponse,
} from './pdu';

function bytes(...values: number[]): Uint8Array {
  return Uint8Array.from(values);
}

describe('request builders', () => {
  it('builds a read-holding-registers request', () => {
    expect(buildReadRequest(FC.READ_HOLDING_REGISTERS, 0x006b, 3)).toEqual(
      bytes(0x03, 0x00, 0x6b, 0x00, 0x03),
    );
  });

  it('builds a write-single-coil request with the 0xFF00 magic value', () => {
    expect(buildWriteSingleCoil(0x00ac, true)).toEqual(bytes(0x05, 0x00, 0xac, 0xff, 0x00));
    expect(buildWriteSingleCoil(0x00ac, false)).toEqual(bytes(0x05, 0x00, 0xac, 0x00, 0x00));
  });

  it('builds a write-single-register request', () => {
    expect(buildWriteSingleRegister(0x0001, 0x0003)).toEqual(
      bytes(0x06, 0x00, 0x01, 0x00, 0x03),
    );
  });

  it('packs multiple coils LSB-first', () => {
    // 10 coils: 1,0,1,1,0,0,1,1 | 1,0  ->  0xCD, 0x01
    const coils = [true, false, true, true, false, false, true, true, true, false];
    expect(buildWriteMultipleCoils(0x0013, coils)).toEqual(
      bytes(0x0f, 0x00, 0x13, 0x00, 0x0a, 0x02, 0xcd, 0x01),
    );
  });

  it('builds a write-multiple-registers request', () => {
    expect(buildWriteMultipleRegisters(0x0001, [0x000a, 0x0102])).toEqual(
      bytes(0x10, 0x00, 0x01, 0x00, 0x02, 0x04, 0x00, 0x0a, 0x01, 0x02),
    );
  });

  it('rejects an out-of-range address', () => {
    expect(() => buildReadRequest(FC.READ_HOLDING_REGISTERS, 0x10000, 1)).toThrow(RangeError);
  });

  it('enforces the 125-register read limit', () => {
    expect(() => buildReadRequest(FC.READ_HOLDING_REGISTERS, 0, 126)).toThrow(RangeError);
    expect(() => buildReadRequest(FC.READ_HOLDING_REGISTERS, 0, 125)).not.toThrow();
  });

  it('enforces the 2000-coil read limit', () => {
    expect(() => buildReadRequest(FC.READ_COILS, 0, 2001)).toThrow(RangeError);
    expect(() => buildReadRequest(FC.READ_COILS, 0, 2000)).not.toThrow();
  });
});

describe('parseReadResponse', () => {
  it('decodes holding registers', () => {
    const pdu = bytes(0x03, 0x06, 0x02, 0x2b, 0x00, 0x00, 0x00, 0x64);
    expect(parseReadResponse(pdu, FC.READ_HOLDING_REGISTERS, 3)).toEqual({
      kind: 'registers',
      values: [0x022b, 0x0000, 0x0064],
    });
  });

  it('decodes coils LSB-first and trims to the requested quantity', () => {
    // byte 0x05 = 0000 0101 -> coil0 on, coil1 off, coil2 on
    const pdu = bytes(0x01, 0x01, 0x05);
    expect(parseReadResponse(pdu, FC.READ_COILS, 3)).toEqual({
      kind: 'bits',
      values: [true, false, true],
    });
  });

  it('throws ModbusExceptionError on an exception response', () => {
    const pdu = bytes(0x83, 0x02);
    expect(() => parseReadResponse(pdu, FC.READ_HOLDING_REGISTERS, 1)).toThrow(
      ModbusExceptionError,
    );
    try {
      parseReadResponse(pdu, FC.READ_HOLDING_REGISTERS, 1);
    } catch (error) {
      const modbus = error as ModbusExceptionError;
      expect(modbus.functionCode).toBe(0x03);
      expect(modbus.exceptionCode).toBe(0x02);
      expect(modbus.hint).toContain('base-0 vs base-1');
    }
  });

  it('rejects a byte count that disagrees with the quantity', () => {
    const pdu = bytes(0x03, 0x04, 0x00, 0x01, 0x00, 0x02);
    expect(() => parseReadResponse(pdu, FC.READ_HOLDING_REGISTERS, 3)).toThrow(
      ModbusTransportError,
    );
  });

  it('rejects a function code that does not match the request', () => {
    const pdu = bytes(0x04, 0x02, 0x00, 0x01);
    expect(() => parseReadResponse(pdu, FC.READ_HOLDING_REGISTERS, 1)).toThrow(
      ModbusTransportError,
    );
  });
});

describe('parseWriteResponse', () => {
  it('decodes the echoed address and value', () => {
    expect(parseWriteResponse(bytes(0x06, 0x00, 0x01, 0x00, 0x03), FC.WRITE_SINGLE_REGISTER))
      .toEqual({ address: 1, value: 3 });
  });

  it('decodes the echoed address and quantity for function 16', () => {
    expect(
      parseWriteResponse(bytes(0x10, 0x00, 0x01, 0x00, 0x02), FC.WRITE_MULTIPLE_REGISTERS),
    ).toEqual({ address: 1, value: 2 });
  });

  it('throws on a truncated write response', () => {
    expect(() => parseWriteResponse(bytes(0x06, 0x00, 0x01), FC.WRITE_SINGLE_REGISTER)).toThrow(
      ModbusTransportError,
    );
  });
});
