import { describe, expect, it } from 'vitest';
import { FC } from '../protocol/pdu';
import { formatAddress, fromPlcAddress, tableOf, toPlcAddress } from './plcAddress';

describe('tableOf', () => {
  it('maps every supported function code to its data table', () => {
    expect(tableOf(FC.READ_COILS)).toBe('coil');
    expect(tableOf(FC.WRITE_SINGLE_COIL)).toBe('coil');
    expect(tableOf(FC.WRITE_MULTIPLE_COILS)).toBe('coil');
    expect(tableOf(FC.READ_DISCRETE_INPUTS)).toBe('discrete');
    expect(tableOf(FC.READ_INPUT_REGISTERS)).toBe('input');
    expect(tableOf(FC.READ_HOLDING_REGISTERS)).toBe('holding');
    expect(tableOf(FC.WRITE_SINGLE_REGISTER)).toBe('holding');
    expect(tableOf(FC.WRITE_MULTIPLE_REGISTERS)).toBe('holding');
  });
});

describe('toPlcAddress', () => {
  it('renders the datasheet notation for address 0 of each table', () => {
    expect(toPlcAddress(FC.READ_COILS, 0)).toBe('00001');
    expect(toPlcAddress(FC.READ_DISCRETE_INPUTS, 0)).toBe('10001');
    expect(toPlcAddress(FC.READ_INPUT_REGISTERS, 0)).toBe('30001');
    expect(toPlcAddress(FC.READ_HOLDING_REGISTERS, 0)).toBe('40001');
  });

  it('is base-1, so protocol address 99 reads as 40100', () => {
    expect(toPlcAddress(FC.READ_HOLDING_REGISTERS, 99)).toBe('40100');
  });

  it('switches to the 6-digit form past 9999', () => {
    expect(toPlcAddress(FC.READ_HOLDING_REGISTERS, 9998)).toBe('49999');
    expect(toPlcAddress(FC.READ_HOLDING_REGISTERS, 9999)).toBe('410000');
    expect(toPlcAddress(FC.READ_HOLDING_REGISTERS, 65535)).toBe('465536');
  });
});

describe('formatAddress', () => {
  it('shows the raw protocol address when base-1 is off', () => {
    expect(formatAddress(FC.READ_HOLDING_REGISTERS, 0, false)).toBe('0');
    expect(formatAddress(FC.READ_HOLDING_REGISTERS, 0, true)).toBe('40001');
  });
});

describe('fromPlcAddress', () => {
  it('round-trips every table', () => {
    for (const fc of [
      FC.READ_COILS,
      FC.READ_DISCRETE_INPUTS,
      FC.READ_INPUT_REGISTERS,
      FC.READ_HOLDING_REGISTERS,
    ]) {
      for (const address of [0, 1, 42, 9998]) {
        const parsed = fromPlcAddress(toPlcAddress(fc, address));
        expect(parsed, `fc ${fc} address ${address}`).toEqual({
          table: tableOf(fc),
          address,
        });
      }
    }
  });

  it('rejects text that is not a PLC address', () => {
    expect(fromPlcAddress('40001x')).toBeNull();
    expect(fromPlcAddress('123')).toBeNull();
    expect(fromPlcAddress('')).toBeNull();
    expect(fromPlcAddress('abcde')).toBeNull();
  });

  it('rejects an unknown table prefix', () => {
    expect(fromPlcAddress('20001')).toBeNull();
    expect(fromPlcAddress('90001')).toBeNull();
  });

  it('rejects a zero one-based address, which cannot exist', () => {
    expect(fromPlcAddress('40000')).toBeNull();
  });
});
