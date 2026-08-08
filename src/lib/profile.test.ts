import { describe, expect, it } from 'vitest';
import { FC } from '../protocol/pdu';
import { defaultDisplay } from '../store/types';
import type { Definition } from '../store/types';
import {
  ProfileError,
  applyProfile,
  definitionToProfile,
  parseCsv,
  parseProfile,
  parseProfileCsv,
  profileToCsv,
  profileToDefinition,
} from './profile';

function definition(overrides: Partial<Definition> = {}): Definition {
  return {
    id: 'd1',
    name: 'Meter',
    slaveId: 1,
    fc: FC.READ_HOLDING_REGISTERS,
    address: 100,
    quantity: 10,
    scanRateMs: 1000,
    enabled: true,
    disableOnError: false,
    display: defaultDisplay(),
    ...overrides,
  };
}

describe('parseCsv', () => {
  it('reads quoted fields, doubled quotes and CRLF', () => {
    expect(parseCsv('a,b\r\n"x,1","he said ""hi"""')).toEqual([
      ['a', 'b'],
      ['x,1', 'he said "hi"'],
    ]);
  });

  it('handles a trailing newline without emitting an empty row', () => {
    expect(parseCsv('a,b\n1,2\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });
});

describe('parseProfileCsv', () => {
  it('reads a register table', () => {
    const csv = [
      'address,name,format,factor,offset,unit',
      '0,Voltage L1,float32_CDAB,1,0,V',
      '2,Current L1,uint16,0.01,,A',
    ].join('\n');

    expect(parseProfileCsv(csv)).toEqual([
      // factor 1 / offset 0 is identity, so it is dropped rather than stored.
      { address: 0, name: 'Voltage L1', format: 'float32_CDAB', unit: 'V' },
      { address: 2, name: 'Current L1', format: 'uint16', factor: 0.01, unit: 'A' },
    ]);
  });

  it('keeps a non-zero offset even when the factor is 1', () => {
    expect(parseProfileCsv('address,factor,offset\n0,1,-40')[0]).toEqual({
      address: 0,
      name: '',
      offset: -40,
    });
  });

  it('does not care about column order or header casing', () => {
    const csv = ['Unit,NAME,Address', 'V,Voltage,4'].join('\n');
    expect(parseProfileCsv(csv)).toEqual([{ address: 4, name: 'Voltage', unit: 'V' }]);
  });

  it('accepts datasheet notation through a plc_address column', () => {
    const csv = ['plc_address,name', '40001,Voltage', '40100,Current'].join('\n');
    expect(parseProfileCsv(csv).map((r) => r.address)).toEqual([0, 99]);
  });

  it('refuses to guess when neither address column is present', () => {
    expect(() => parseProfileCsv('name,unit\nVoltage,V')).toThrow(/address.*plc_address/);
  });

  it('rejects an unknown format rather than silently ignoring it', () => {
    expect(() => parseProfileCsv('address,format\n0,float33_ABCD')).toThrow(/not a known format/);
  });

  it('rejects an out-of-range address', () => {
    expect(() => parseProfileCsv('address,name\n70000,Nope')).toThrow(/0–65535/);
  });

  it('rejects a PLC address that is not one', () => {
    expect(() => parseProfileCsv('plc_address,name\n123,Nope')).toThrow(/not a PLC address/);
  });

  it('skips blank lines', () => {
    const csv = ['address,name', '0,A', '', '1,B'].join('\n');
    expect(parseProfileCsv(csv)).toHaveLength(2);
  });

  it('drops a zero factor, which would flatten every reading', () => {
    expect(parseProfileCsv('address,factor\n0,0')[0].factor).toBeUndefined();
  });
});

describe('parseProfile', () => {
  it('sniffs JSON', () => {
    const profile = parseProfile('{"device":"PM-3000","registers":[{"address":0,"name":"V"}]}');
    expect(profile.device).toBe('PM-3000');
    expect(profile.registers).toHaveLength(1);
  });

  it('sniffs CSV', () => {
    expect(parseProfile('address,name\n0,V').registers).toHaveLength(1);
  });

  it('rejects an empty file', () => {
    expect(() => parseProfile('   ')).toThrow(ProfileError);
  });

  it('refuses a profile from a newer build', () => {
    expect(() => parseProfile('{"version":99,"registers":[]}')).toThrow(/newer version/);
  });

  it('requires a registers array', () => {
    expect(() => parseProfile('{"device":"x"}')).toThrow(/registers/);
  });
});

describe('applyProfile', () => {
  it('maps absolute addresses onto row offsets', () => {
    const def = definition({ address: 100, quantity: 10 });
    const { display, applied, skipped } = applyProfile(def, {
      version: 1,
      device: 'PM',
      registers: [
        { address: 100, name: 'Voltage', unit: 'V', factor: 0.1 },
        { address: 105, name: 'Current' },
      ],
    });

    expect(applied).toBe(2);
    expect(skipped).toEqual([]);
    expect(display.rows[0]).toEqual({ name: 'Voltage', unit: 'V', scaling: { factor: 0.1, offset: 0 } });
    expect(display.rows[5]).toEqual({ name: 'Current' });
  });

  it('reports registers outside the range instead of dropping them silently', () => {
    const def = definition({ address: 100, quantity: 4 });
    const { applied, skipped } = applyProfile(def, {
      version: 1,
      device: 'PM',
      registers: [
        { address: 100, name: 'In range' },
        { address: 99, name: 'Before' },
        { address: 200, name: 'After' },
      ],
    });

    expect(applied).toBe(1);
    expect(skipped.map((r) => r.name)).toEqual(['Before', 'After']);
  });

  it('keeps existing row settings the profile does not mention', () => {
    const def = definition({
      display: { ...defaultDisplay(), rows: { 0: { format: 'int16', unit: 'kW' } } },
    });
    const { display } = applyProfile(def, {
      version: 1,
      device: 'PM',
      registers: [{ address: 100, name: 'Power' }],
    });

    expect(display.rows[0]).toEqual({ format: 'int16', unit: 'kW', name: 'Power' });
  });
});

describe('profileToDefinition', () => {
  it('builds a definition from a profile that carries the layout', () => {
    const def = profileToDefinition(
      {
        version: 1,
        device: 'PM-3000',
        slaveId: 7,
        fc: FC.READ_INPUT_REGISTERS,
        address: 10,
        quantity: 6,
        registers: [{ address: 10, name: 'Voltage', unit: 'V' }],
      },
      'new-1',
    );

    expect(def).toMatchObject({
      id: 'new-1',
      name: 'PM-3000',
      slaveId: 7,
      fc: FC.READ_INPUT_REGISTERS,
      address: 10,
      quantity: 6,
    });
    expect(def.display.rows[0]).toEqual({ name: 'Voltage', unit: 'V' });
  });

  it('derives the range from the registers when the profile omits it', () => {
    const def = profileToDefinition(
      {
        version: 1,
        device: 'PM',
        registers: [
          { address: 4, name: 'A' },
          { address: 9, name: 'B' },
        ],
      },
      'new-2',
    );
    expect(def.address).toBe(4);
    expect(def.quantity).toBe(6);
  });

  it('clamps a range that exceeds the per-request register limit', () => {
    const def = profileToDefinition(
      {
        version: 1,
        device: 'PM',
        registers: [
          { address: 0, name: 'A' },
          { address: 400, name: 'B' },
        ],
      },
      'new-3',
    );
    expect(def.quantity).toBe(125);
  });
});

describe('round trip', () => {
  it('exports and re-imports the same register map', () => {
    const original = definition({
      address: 100,
      display: {
        ...defaultDisplay(),
        defaultFormat: 'float32_CDAB',
        rows: {
          0: { name: 'Voltage L1', unit: 'V', scaling: { factor: 0.1, offset: 0 } },
          2: { name: 'Current L1', format: 'uint16', unit: 'A' },
        },
      },
    });

    const restored = profileToDefinition(definitionToProfile(original), 'copy');
    expect(restored.display.rows).toEqual(original.display.rows);
    expect(restored.address).toBe(original.address);
    expect(restored.display.defaultFormat).toBe('float32_CDAB');
  });

  it('survives a CSV round trip in PLC notation', () => {
    const def = definition({
      address: 0,
      display: {
        ...defaultDisplay(),
        rows: { 0: { name: 'Voltage', unit: 'V', scaling: { factor: 0.1, offset: 2 } } },
      },
    });

    const csv = profileToCsv(definitionToProfile(def), def.fc, true);
    expect(csv.split('\n')[0]).toBe('plc_address,name,format,factor,offset,unit');

    const registers = parseProfileCsv(csv);
    expect(registers[0]).toMatchObject({
      address: 0,
      name: 'Voltage',
      factor: 0.1,
      offset: 2,
      unit: 'V',
    });
  });

  it('exports only rows that carry configuration', () => {
    const def = definition({
      display: { ...defaultDisplay(), rows: { 0: { name: 'A' }, 1: {}, 2: { unit: 'V' } } },
    });
    expect(definitionToProfile(def).registers.map((r) => r.address)).toEqual([100, 102]);
  });
});
