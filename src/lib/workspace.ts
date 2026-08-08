/**
 * Workspace save/load — the web equivalent of Modbus Poll's .mbw files.
 *
 * Import validates rather than trusts: a workspace is a plain JSON file that
 * gets emailed around and hand-edited, so a malformed one must produce a clear
 * message instead of a half-configured app pointed at the wrong slave.
 */

import { DEFAULT_MASTER_OPTIONS } from '../core/master';
import type { MasterOptions, SerialMode } from '../core/master';
import { SUPPORTED_FUNCTION_CODES } from '../protocol/pdu';
import { FORMATS } from '../protocol/formats';
import type { FormatId } from '../protocol/formats';
import { DEFAULT_SERIAL_SETTINGS } from '../transport/link';
import type { SerialSettings } from '../transport/link';
import type {
  ColorRule,
  ConditionalColor,
  Definition,
  DisplayConfig,
  RowConfig,
  Scaling,
} from '../store/types';
import { CONDITIONAL_COLORS, defaultDisplay } from '../store/types';

export const WORKSPACE_VERSION = 2;

export interface Workspace {
  version: number;
  savedAt: string;
  connection: {
    settings: SerialSettings;
    mode: SerialMode;
    master: MasterOptions;
  };
  plcBase1: boolean;
  definitions: Definition[];
}

export class WorkspaceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkspaceError';
  }
}

const FORMAT_IDS = new Set<string>(FORMATS.map((f) => f.id));
const READ_FCS = new Set<number>([1, 2, 3, 4]);
const COLORS = new Set<string>(CONDITIONAL_COLORS);

export function buildWorkspace(
  connection: Workspace['connection'],
  definitions: Definition[],
  plcBase1: boolean,
): Workspace {
  return {
    version: WORKSPACE_VERSION,
    savedAt: new Date().toISOString(),
    connection,
    plcBase1,
    definitions,
  };
}

export function serializeWorkspace(workspace: Workspace): string {
  return JSON.stringify(workspace, null, 2);
}

export function parseWorkspace(text: string): Workspace {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new WorkspaceError('Not valid JSON.');
  }
  return validateWorkspace(raw);
}

export function validateWorkspace(raw: unknown): Workspace {
  if (!isRecord(raw)) throw new WorkspaceError('Workspace must be a JSON object.');

  const version = Number(raw.version);
  if (!Number.isFinite(version)) throw new WorkspaceError('Missing workspace version.');
  if (version > WORKSPACE_VERSION) {
    throw new WorkspaceError(
      `This workspace was saved by a newer version (v${version}). Update rapid_modbus first.`,
    );
  }

  if (!Array.isArray(raw.definitions)) {
    throw new WorkspaceError('Workspace has no definitions array.');
  }

  const connection = isRecord(raw.connection) ? raw.connection : {};
  return {
    version: WORKSPACE_VERSION,
    savedAt: typeof raw.savedAt === 'string' ? raw.savedAt : new Date().toISOString(),
    connection: {
      settings: readSettings(connection.settings),
      mode: connection.mode === 'ascii' ? 'ascii' : 'rtu',
      master: readMasterOptions(connection.master),
    },
    plcBase1: raw.plcBase1 === true,
    definitions: raw.definitions.map((entry, index) => readDefinition(entry, index)),
  };
}

function readSettings(raw: unknown): SerialSettings {
  if (!isRecord(raw)) return { ...DEFAULT_SERIAL_SETTINGS };
  const baudRate = Number(raw.baudRate);
  const parity = raw.parity;
  return {
    baudRate:
      Number.isFinite(baudRate) && baudRate > 0 ? baudRate : DEFAULT_SERIAL_SETTINGS.baudRate,
    dataBits: raw.dataBits === 7 ? 7 : 8,
    stopBits: raw.stopBits === 2 ? 2 : 1,
    parity: parity === 'even' || parity === 'odd' ? parity : 'none',
  };
}

function readMasterOptions(raw: unknown): MasterOptions {
  if (!isRecord(raw)) return { ...DEFAULT_MASTER_OPTIONS };
  return {
    mode: raw.mode === 'ascii' ? 'ascii' : 'rtu',
    responseTimeoutMs: clampNumber(raw.responseTimeoutMs, 50, 60_000, 1000),
    retries: clampNumber(raw.retries, 0, 10, 0),
    interFrameDelayMs: clampNumber(raw.interFrameDelayMs, 0, 5000, 10),
  };
}

function readDefinition(raw: unknown, index: number): Definition {
  if (!isRecord(raw)) throw new WorkspaceError(`Definition ${index + 1} is not an object.`);

  const fc = Number(raw.fc);
  if (!READ_FCS.has(fc)) {
    throw new WorkspaceError(
      `Definition ${index + 1} has function code ${raw.fc}; polling supports 01–04.`,
    );
  }

  const slaveId = clampNumber(raw.slaveId, 0, 255, 1);
  const address = clampNumber(raw.address, 0, 65535, 0);
  const maxQuantity = fc === 1 || fc === 2 ? 2000 : 125;
  const quantity = clampNumber(raw.quantity, 1, maxQuantity, 1);

  if (address + quantity > 65536) {
    throw new WorkspaceError(
      `Definition ${index + 1} runs past address 65535 (${address} + ${quantity}).`,
    );
  }

  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : `def-${index + 1}`,
    name: typeof raw.name === 'string' ? raw.name : `Definition ${index + 1}`,
    slaveId,
    fc: fc as Definition['fc'],
    address,
    quantity,
    scanRateMs: clampNumber(raw.scanRateMs, 0, 3_600_000, 1000),
    enabled: raw.enabled !== false,
    disableOnError: raw.disableOnError === true,
    display: readDisplay(raw.display),
  };
}

export function readDisplay(raw: unknown): DisplayConfig {
  const fallback = defaultDisplay();
  if (!isRecord(raw)) return fallback;

  return {
    defaultFormat: isFormatId(raw.defaultFormat) ? raw.defaultFormat : fallback.defaultFormat,
    rows: readRows(raw),
    valueNames: readValueNames(raw.valueNames),
    colorRules: readColorRules(raw.colorRules),
  };
}

/**
 * v1 kept `formats` and `names` as separate maps; v2 merges them into one
 * per-row record so scaling and units have somewhere to live.
 */
function readRows(display: Record<string, unknown>): Record<number, RowConfig> {
  const rows: Record<number, RowConfig> = {};

  const put = (key: string, patch: RowConfig) => {
    const offset = Number(key);
    if (!Number.isInteger(offset) || offset < 0) return;
    // A row whose only setting was dropped as invalid should vanish, not
    // linger as an empty object.
    const merged = { ...rows[offset], ...patch };
    if (Object.keys(merged).length > 0) rows[offset] = merged;
  };

  if (isRecord(display.formats)) {
    for (const [key, value] of Object.entries(display.formats)) {
      // Silently drop unknown formats — an old file should still open.
      if (isFormatId(value)) put(key, { format: value });
    }
  }
  if (isRecord(display.names)) {
    for (const [key, value] of Object.entries(display.names)) {
      if (typeof value === 'string') put(key, { name: value });
    }
  }

  if (isRecord(display.rows)) {
    for (const [key, value] of Object.entries(display.rows)) {
      if (!isRecord(value)) continue;
      const config: RowConfig = {};
      if (typeof value.name === 'string') config.name = value.name;
      if (isFormatId(value.format)) config.format = value.format;
      if (typeof value.unit === 'string') config.unit = value.unit;
      const scaling = readScaling(value.scaling);
      if (scaling) config.scaling = scaling;
      put(key, config);
    }
  }

  return rows;
}

function readScaling(raw: unknown): Scaling | undefined {
  if (!isRecord(raw)) return undefined;
  const factor = Number(raw.factor);
  const offset = Number(raw.offset);
  // A zero factor would flatten every reading to a constant and make the
  // write dialog's inverse undefined, so treat it as unset.
  if (!Number.isFinite(factor) || factor === 0) return undefined;
  return { factor, offset: Number.isFinite(offset) ? offset : 0 };
}

function readValueNames(raw: unknown): Record<number, string> {
  const out: Record<number, string> = {};
  if (!isRecord(raw)) return out;
  for (const [key, value] of Object.entries(raw)) {
    const numeric = Number(key);
    if (Number.isInteger(numeric) && typeof value === 'string' && value) out[numeric] = value;
  }
  return out;
}

function readColorRules(raw: unknown): ColorRule[] {
  if (!Array.isArray(raw)) return [];
  const rules: ColorRule[] = [];
  for (const [index, entry] of raw.entries()) {
    if (!isRecord(entry)) continue;
    const min = Number(entry.min);
    const max = Number(entry.max);
    if (!Number.isFinite(min) || !Number.isFinite(max)) continue;
    const color = COLORS.has(String(entry.color))
      ? (entry.color as ConditionalColor)
      : 'amber';
    rules.push({
      id: typeof entry.id === 'string' && entry.id ? entry.id : `rule-${index + 1}`,
      // Tolerate reversed bounds rather than silently matching nothing.
      min: Math.min(min, max),
      max: Math.max(min, max),
      color,
    });
  }
  return rules;
}

function isFormatId(value: unknown): value is FormatId {
  return typeof value === 'string' && FORMAT_IDS.has(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function clampNumber(raw: unknown, min: number, max: number, fallback: number): number {
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

/** Function codes a poll definition may use. */
export const POLL_FUNCTION_CODES = SUPPORTED_FUNCTION_CODES.filter((fc) => READ_FCS.has(fc));
