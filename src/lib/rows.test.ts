import { describe, expect, it } from 'vitest';
import { FC } from '../protocol/pdu';
import { defaultDisplay } from '../store/types';
import type { Definition, DefinitionState } from '../store/types';
import { EMPTY_STATE } from '../store/types';
import { applyScaling, buildRows, formatFor, matchColor, removeScaling } from './rows';

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
      display: { ...defaultDisplay(), defaultFormat: 'int16', rows: { 2: { format: 'hex16' } } },
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
    expect(rows.map((r) => r.text)).toEqual(['1', '2', '3', '4']);
  });

  it('collapses two registers into one row for a 32-bit format', () => {
    const def = definition({ display: { ...defaultDisplay(), defaultFormat: 'float32_ABCD' } });
    const rows = buildRows(def, stateWith([0x41c8, 0x0000, 0x41c8, 0x0000]));

    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.address)).toEqual([100, 102]);
    expect(rows.map((r) => r.text)).toEqual(['25', '25']);
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
      display: { ...defaultDisplay(), rows: { 1: { format: 'float32_ABCD' } } },
    });
    const rows = buildRows(def, stateWith([7, 0x41c8, 0x0000, 9]));

    expect(rows.map((r) => r.offset)).toEqual([0, 1, 3]);
    expect(rows.map((r) => r.text)).toEqual(['7', '25', '9']);
  });

  it('leaves a wide format at the tail undecoded rather than reading past the range', () => {
    const def = definition({
      quantity: 3,
      display: { ...defaultDisplay(), rows: { 2: { format: 'float32_ABCD' } } },
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
    const def = definition({ display: { ...defaultDisplay(), rows: { 0: { name: 'Voltage L1' } } } });
    const rows = buildRows(def, stateWith([2314, 0, 0, 0]));
    expect(rows[0].name).toBe('Voltage L1');
    expect(rows[1].name).toBe('');
  });

  it('keeps the raw registers available for the write dialog', () => {
    const def = definition({ display: { ...defaultDisplay(), defaultFormat: 'int32_ABCD' } });
    const rows = buildRows(def, stateWith([0x1234, 0x5678, 0, 0]));
    expect(rows[0].registers).toEqual([0x1234, 0x5678]);
  });
});

describe('scaling', () => {
  it('applies factor and offset', () => {
    expect(applyScaling(2314, { factor: 0.1, offset: 0 })).toBeCloseTo(231.4, 6);
    expect(applyScaling(100, { factor: 2, offset: 5 })).toBe(205);
  });

  it('is a no-op when unset or identity', () => {
    expect(applyScaling(42, undefined)).toBe(42);
    expect(applyScaling(42, { factor: 1, offset: 0 })).toBe(42);
  });

  it('round-trips through removeScaling', () => {
    for (const scaling of [{ factor: 0.1, offset: 0 }, { factor: 2, offset: -5 }]) {
      expect(removeScaling(applyScaling(1234, scaling), scaling)).toBeCloseTo(1234, 6);
    }
  });

  it('shows the scaled value with its unit, not the raw one', () => {
    const def = definition({
      display: {
        ...defaultDisplay(),
        rows: { 0: { scaling: { factor: 0.1, offset: 0 }, unit: 'V' } },
      },
    });
    const rows = buildRows(def, stateWith([2314, 0, 0, 0]));

    expect(rows[0].scaled).toBeCloseTo(231.4, 6);
    // Binary float noise must never reach the panel.
    expect(rows[0].text).toBe('231.4 V');
    expect(rows[0].decoded?.text).toBe('2314');
  });

  it('appends a unit even without scaling', () => {
    const def = definition({ display: { ...defaultDisplay(), rows: { 0: { unit: 'Hz' } } } });
    expect(buildRows(def, stateWith([50, 0, 0, 0]))[0].text).toBe('50 Hz');
  });
});

describe('value names', () => {
  it('replaces the raw value with its label', () => {
    const def = definition({
      display: { ...defaultDisplay(), valueNames: { 0: 'Off', 1: 'Run', 2: 'Fault' } },
    });
    const rows = buildRows(def, stateWith([2, 1, 0, 9]));

    expect(rows.map((r) => r.text)).toEqual(['Fault', 'Run', 'Off', '9']);
  });

  it('matches the raw value, before scaling', () => {
    const def = definition({
      display: {
        ...defaultDisplay(),
        valueNames: { 3: 'Tripped' },
        rows: { 0: { scaling: { factor: 10, offset: 0 } } },
      },
    });
    expect(buildRows(def, stateWith([3, 0, 0, 0]))[0].text).toBe('Tripped');
  });
});

describe('conditional colours', () => {
  const rules = [
    { id: 'a', min: 0, max: 10, color: 'red' as const },
    { id: 'b', min: 5, max: 20, color: 'green' as const },
  ];

  it('returns the first matching rule so ordering expresses precedence', () => {
    expect(matchColor(7, rules)).toBe('red');
    expect(matchColor(15, rules)).toBe('green');
  });

  it('treats bounds as inclusive', () => {
    expect(matchColor(0, rules)).toBe('red');
    expect(matchColor(10, rules)).toBe('red');
    expect(matchColor(20, rules)).toBe('green');
  });

  it('returns null outside every band and for missing values', () => {
    expect(matchColor(21, rules)).toBeNull();
    expect(matchColor(null, rules)).toBeNull();
  });

  it('compares against the scaled value, which is what the operator reads', () => {
    const def = definition({
      display: {
        ...defaultDisplay(),
        rows: { 0: { scaling: { factor: 0.1, offset: 0 } } },
        colorRules: [{ id: 'high', min: 250, max: 1000, color: 'red' }],
      },
    });

    // Raw 2600 is inside the band, but 260.0 V is what matters.
    expect(buildRows(def, stateWith([2600, 0, 0, 0]))[0].color).toBe('red');
    expect(buildRows(def, stateWith([2314, 0, 0, 0]))[0].color).toBeNull();
  });
});

describe('bit rows', () => {
  it('produces one row per coil', () => {
    const def = definition({ fc: FC.READ_COILS, quantity: 3, address: 10 });
    const rows = buildRows(def, stateWith([true, false, true]));

    expect(rows.map((r) => r.address)).toEqual([10, 11, 12]);
    expect(rows.map((r) => r.bit)).toEqual([true, false, true]);
    expect(rows.map((r) => r.text)).toEqual(['1', '0', '1']);
  });

  it('applies value names to coils too', () => {
    const def = definition({
      fc: FC.READ_COILS,
      quantity: 2,
      display: { ...defaultDisplay(), valueNames: { 0: 'Open', 1: 'Closed' } },
    });
    expect(buildRows(def, stateWith([true, false])).map((r) => r.text)).toEqual([
      'Closed',
      'Open',
    ]);
  });

  it('renders discrete inputs as empty rows before the first poll', () => {
    const def = definition({ fc: FC.READ_DISCRETE_INPUTS, quantity: 2 });
    const rows = buildRows(def, EMPTY_STATE);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.bit === null)).toBe(true);
  });
});
