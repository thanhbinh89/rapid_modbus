import { describe, expect, it } from 'vitest';
import { FC } from '../protocol/pdu';
import { defaultDisplay } from '../store/types';
import type { Definition } from '../store/types';
import {
  WORKSPACE_VERSION,
  WorkspaceError,
  buildWorkspace,
  parseWorkspace,
  serializeWorkspace,
  validateWorkspace,
} from './workspace';

function definition(overrides: Partial<Definition> = {}): Definition {
  return {
    id: 'd1',
    name: 'Meter',
    slaveId: 1,
    fc: FC.READ_HOLDING_REGISTERS,
    address: 0,
    quantity: 10,
    scanRateMs: 1000,
    enabled: true,
    disableOnError: false,
    display: defaultDisplay(),
    ...overrides,
  };
}

const connection = {
  settings: { baudRate: 19200, dataBits: 8, stopBits: 1, parity: 'even' } as const,
  mode: 'rtu' as const,
  master: { mode: 'rtu' as const, responseTimeoutMs: 500, retries: 1, interFrameDelayMs: 5 },
};

describe('round trip', () => {
  it('survives serialize then parse unchanged', () => {
    const original = buildWorkspace(
      connection,
      [
        definition({
          display: {
            defaultFormat: 'float32_CDAB',
            rows: {
              0: { name: 'Voltage L1', unit: 'V', scaling: { factor: 0.1, offset: 0 } },
              2: { format: 'int16' },
            },
            valueNames: { 0: 'Off', 1: 'Run' },
            colorRules: [{ id: 'r1', min: 250, max: 999, color: 'red' }],
          },
        }),
      ],
      true,
    );
    const restored = parseWorkspace(serializeWorkspace(original));

    expect(restored.connection).toEqual(original.connection);
    expect(restored.plcBase1).toBe(true);
    expect(restored.definitions).toEqual(original.definitions);
  });

  it('stamps the current version and a save time', () => {
    const workspace = buildWorkspace(connection, [definition()], false);
    expect(workspace.version).toBe(WORKSPACE_VERSION);
    expect(Date.parse(workspace.savedAt)).not.toBeNaN();
  });
});

describe('validation', () => {
  it('rejects text that is not JSON', () => {
    expect(() => parseWorkspace('{oops')).toThrow(WorkspaceError);
  });

  it('rejects a non-object workspace', () => {
    expect(() => validateWorkspace([])).toThrow(/must be a JSON object/);
  });

  it('rejects a workspace with no version', () => {
    expect(() => validateWorkspace({ definitions: [] })).toThrow(/version/);
  });

  it('refuses a workspace from a newer build rather than guessing', () => {
    expect(() => validateWorkspace({ version: 99, definitions: [] })).toThrow(/newer version/);
  });

  it('rejects a missing definitions array', () => {
    expect(() => validateWorkspace({ version: 1 })).toThrow(/definitions array/);
  });

  it('rejects a write function code in a poll definition', () => {
    expect(() =>
      validateWorkspace({ version: 1, definitions: [{ ...definition(), fc: 6 }] }),
    ).toThrow(/supports 01–04/);
  });

  it('rejects a range that runs past the end of the address space', () => {
    expect(() =>
      validateWorkspace({
        version: 1,
        definitions: [{ ...definition(), address: 65530, quantity: 100 }],
      }),
    ).toThrow(/past address 65535/);
  });
});

describe('repair of sloppy input', () => {
  it('clamps out-of-range numbers instead of failing', () => {
    const workspace = validateWorkspace({
      version: 1,
      definitions: [{ ...definition(), slaveId: 999, quantity: 5000, scanRateMs: -5 }],
    });
    const parsed = workspace.definitions[0];
    expect(parsed.slaveId).toBe(255);
    expect(parsed.quantity).toBe(125);
    expect(parsed.scanRateMs).toBe(0);
  });

  it('allows 2000 coils but only 125 registers', () => {
    const coils = validateWorkspace({
      version: 1,
      definitions: [{ ...definition(), fc: FC.READ_COILS, quantity: 2000 }],
    });
    expect(coils.definitions[0].quantity).toBe(2000);
  });

  it('falls back to defaults for a missing connection block', () => {
    const workspace = validateWorkspace({ version: 1, definitions: [] });
    expect(workspace.connection.settings.baudRate).toBe(9600);
    expect(workspace.connection.mode).toBe('rtu');
  });

  it('drops an unknown format rather than refusing the file', () => {
    const workspace = validateWorkspace({
      version: 2,
      definitions: [
        {
          ...definition(),
          display: {
            defaultFormat: 'not_a_format',
            rows: { 0: { format: 'nope' }, 1: { format: 'int16' } },
          },
        },
      ],
    });
    const display = workspace.definitions[0].display;
    expect(display.defaultFormat).toBe('uint16');
    expect(display.rows).toEqual({ 1: { format: 'int16' } });
  });

  it('drops a zero scaling factor, which has no inverse', () => {
    const workspace = validateWorkspace({
      version: 2,
      definitions: [
        { ...definition(), display: { rows: { 0: { scaling: { factor: 0, offset: 3 } } } } },
      ],
    });
    expect(workspace.definitions[0].display.rows[0]?.scaling).toBeUndefined();
  });

  it('straightens reversed colour-rule bounds instead of matching nothing', () => {
    const workspace = validateWorkspace({
      version: 2,
      definitions: [
        {
          ...definition(),
          display: { colorRules: [{ id: 'r', min: 100, max: 10, color: 'green' }] },
        },
      ],
    });
    expect(workspace.definitions[0].display.colorRules[0]).toMatchObject({ min: 10, max: 100 });
  });

  it('falls back to a known colour for an unknown one', () => {
    const workspace = validateWorkspace({
      version: 2,
      definitions: [
        { ...definition(), display: { colorRules: [{ min: 0, max: 1, color: 'chartreuse' }] } },
      ],
    });
    expect(workspace.definitions[0].display.colorRules[0].color).toBe('amber');
  });
});

describe('v1 migration', () => {
  it('merges the old formats and names maps into per-row config', () => {
    const workspace = validateWorkspace({
      version: 1,
      definitions: [
        {
          ...definition(),
          display: {
            defaultFormat: 'int16',
            formats: { 0: 'float32_ABCD', 2: 'hex16' },
            names: { 0: 'Voltage L1', 3: 'Status' },
          },
        },
      ],
    });

    const display = workspace.definitions[0].display;
    expect(display.defaultFormat).toBe('int16');
    expect(display.rows).toEqual({
      0: { format: 'float32_ABCD', name: 'Voltage L1' },
      2: { format: 'hex16' },
      3: { name: 'Status' },
    });
    // v1 had neither of these; they must come back as empty, not undefined.
    expect(display.valueNames).toEqual({});
    expect(display.colorRules).toEqual([]);
  });

  it('stamps migrated workspaces with the current version', () => {
    const workspace = validateWorkspace({ version: 1, definitions: [] });
    expect(workspace.version).toBe(WORKSPACE_VERSION);
  });

  it('generates an id and name when they are missing', () => {
    const workspace = validateWorkspace({
      version: 1,
      definitions: [{ fc: 3, slaveId: 1, address: 0, quantity: 1 }],
    });
    expect(workspace.definitions[0].id).toBe('def-1');
    expect(workspace.definitions[0].name).toBe('Definition 1');
  });

  it('treats a missing enabled flag as enabled', () => {
    const workspace = validateWorkspace({
      version: 1,
      definitions: [{ fc: 3, slaveId: 1, address: 0, quantity: 1 }],
    });
    expect(workspace.definitions[0].enabled).toBe(true);
  });
});
