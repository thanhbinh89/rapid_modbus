import { describe, expect, it } from 'vitest';
import { FC } from '../protocol/pdu';
import { defaultDisplay } from '../store/types';
import type { Definition, DefinitionState } from '../store/types';
import { EMPTY_STATE } from '../store/types';
import { buildRows, formatFor } from './rows';

function definition(overrides: Partial<Definition> = {}): Definition {
  return {
    id: 'd1',
    name: 'Meter',
    slaveId: 1,
    fc: FC.READ_HOLDING_REGISTERS,
    address: 100,
    quantity: 4,
    scanRateMs: 1000,
    enabled: true,
    disableOnError: false,
    display: defaultDisplay(),
    ...overrides,
  };
}

function stateWith(values: number[] | boolean[]): DefinitionState {
  return { ...EMPTY_STATE, values, at: Date.now() };
}

describe('formatFor', () => {
  it('falls back to the definition default', () => {
    const def = definition({ display: { ...defaultDisplay(), defaultFormat: 'int16' } });
    expect(formatFor(def, 0)).toBe('int16');
  });

  it('prefers a per-row override', () => {
    const def = definition({
      display: { defaultFormat: 'int16', formats: { 2: 'hex16' }, names: {} },
    });
    expect(formatFor(def, 2)).toBe('hex16');
    expect(formatFor(def, 1)).toBe('int16');
  });
});

describe('register rows', () => {
  it('produces one row per register for 16-bit formats', () => {
    const rows = buildRows(definition(), stateWith([1, 2, 3, 4]));
    expect(rows).toHaveLength(4);
    expect(rows.map((r) => r.address)).toEqual([100, 101, 102, 103]);
    expect(rows.map((r) => r.decoded?.text)).toEqual(['1', '2', '3', '4']);
  });

  it('collapses two registers into one row for a 32-bit format', () => {
    const def = definition({
      display: { ...defaultDisplay(), defaultFormat: 'float32_ABCD' },
    });
    const rows = buildRows(def, stateWith([0x41c8, 0x0000, 0x41c8, 0x0000]));

    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.address)).toEqual([100, 102]);
    expect(rows.map((r) => r.decoded?.text)).toEqual(['25', '25']);
  });

  it('collapses four registers into one row for a 64-bit format', () => {
    const def = definition({
      quantity: 8,
      display: { ...defaultDisplay(), defaultFormat: 'uint64_ABCD' },
    });
    const rows = buildRows(def, stateWith([0, 0, 0, 1, 0, 0, 0, 2]));

    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.decoded?.big)).toEqual([1n, 2n]);
  });

  it('mixes widths when rows override the default format', () => {
    const def = definition({
      quantity: 4,
      display: { defaultFormat: 'uint16', formats: { 1: 'float32_ABCD' }, names: {} },
    });
    const rows = buildRows(def, stateWith([7, 0x41c8, 0x0000, 9]));

    expect(rows.map((r) => r.offset)).toEqual([0, 1, 3]);
    expect(rows.map((r) => r.decoded?.text)).toEqual(['7', '25', '9']);
  });

  it('leaves a wide format at the tail undecoded rather than reading past the range', () => {
    const def = definition({
      quantity: 3,
      display: { defaultFormat: 'uint16', formats: { 2: 'float32_ABCD' }, names: {} },
    });
    const rows = buildRows(def, stateWith([1, 2, 3]));

    expect(rows).toHaveLength(3);
    expect(rows[2].decoded).toBeNull();
  });

  it('renders empty rows before the first successful poll', () => {
    const rows = buildRows(definition(), EMPTY_STATE);
    expect(rows).toHaveLength(4);
    expect(rows.every((r) => r.decoded === null)).toBe(true);
    expect(rows.map((r) => r.address)).toEqual([100, 101, 102, 103]);
  });

  it('carries operator-supplied names through', () => {
    const def = definition({
      display: { ...defaultDisplay(), names: { 0: 'Voltage L1' } },
    });
    const rows = buildRows(def, stateWith([2314, 0, 0, 0]));
    expect(rows[0].name).toBe('Voltage L1');
    expect(rows[1].name).toBe('');
  });

  it('keeps the raw registers available for the write dialog', () => {
    const def = definition({
      display: { ...defaultDisplay(), defaultFormat: 'int32_ABCD' },
    });
    const rows = buildRows(def, stateWith([0x1234, 0x5678, 0, 0]));
    expect(rows[0].registers).toEqual([0x1234, 0x5678]);
  });
});

describe('bit rows', () => {
  it('produces one row per coil', () => {
    const def = definition({ fc: FC.READ_COILS, quantity: 3, address: 10 });
    const rows = buildRows(def, stateWith([true, false, true]));

    expect(rows.map((r) => r.address)).toEqual([10, 11, 12]);
    expect(rows.map((r) => r.bit)).toEqual([true, false, true]);
    expect(rows.map((r) => r.decoded?.text)).toEqual(['1', '0', '1']);
  });

  it('renders discrete inputs as empty rows before the first poll', () => {
    const def = definition({ fc: FC.READ_DISCRETE_INPUTS, quantity: 2 });
    const rows = buildRows(def, EMPTY_STATE);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.bit === null)).toBe(true);
  });
});
