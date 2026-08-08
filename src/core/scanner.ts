/**
 * Discovery tools: find the device, then find its registers.
 *
 * The load-bearing insight is that a Modbus **exception** reply still proves a
 * device is listening — "illegal data address" means it is there and simply
 * does not have that register. Only silence means nothing is home. Treating
 * exceptions as hits is what makes a slave scan actually useful on site.
 */

import { ModbusExceptionError } from '../protocol/errors';
import { FC } from '../protocol/pdu';
import type { SerialSettings } from '../transport/link';
import type { ModbusMaster, SerialMode } from './master';
import type { ModbusResult } from './request';
import type { ReadFunctionCode } from './scheduler';

export interface ScanProgress {
  done: number;
  total: number;
  /** What is being tried right now, ready to show in a status line. */
  label: string;
}

export interface ScanOptions {
  signal?: AbortSignal;
  onProgress?: (progress: ScanProgress) => void;
}

export type Presence =
  | { kind: 'data'; result: ModbusResult }
  | { kind: 'exception'; exceptionCode: number }
  | { kind: 'silent' };

/** One probe. Never throws for the ordinary "not there" case. */
export async function probe(
  master: ModbusMaster,
  slaveId: number,
  fc: ReadFunctionCode,
  address: number,
  quantity: number,
): Promise<Presence> {
  try {
    const result = await master.execute({ fc, slaveId, address, quantity });
    return { kind: 'data', result };
  } catch (error) {
    if (error instanceof ModbusExceptionError) {
      return { kind: 'exception', exceptionCode: error.exceptionCode };
    }
    return { kind: 'silent' };
  }
}

// --- Slave ID scan ----------------------------------------------------------

export interface SlaveScanHit {
  slaveId: number;
  /** `exception` still means a device is present — it just refused the read. */
  via: 'data' | 'exception';
  exceptionCode?: number;
}

export interface SlaveScanOptions extends ScanOptions {
  from?: number;
  to?: number;
  fc?: ReadFunctionCode;
  address?: number;
  quantity?: number;
  onHit?: (hit: SlaveScanHit) => void;
}

/** Walks a range of slave IDs looking for anything that answers. */
export async function scanSlaveIds(
  master: ModbusMaster,
  options: SlaveScanOptions = {},
): Promise<SlaveScanHit[]> {
  const from = options.from ?? 1;
  const to = options.to ?? 247;
  const fc = options.fc ?? FC.READ_HOLDING_REGISTERS;
  const address = options.address ?? 0;
  const quantity = options.quantity ?? 1;

  const hits: SlaveScanHit[] = [];
  const total = to - from + 1;

  for (let slaveId = from; slaveId <= to; slaveId++) {
    if (options.signal?.aborted) break;
    options.onProgress?.({
      done: slaveId - from,
      total,
      label: `Slave ID ${slaveId}`,
    });

    const presence = await probe(master, slaveId, fc, address, quantity);
    if (presence.kind === 'silent') continue;

    const hit: SlaveScanHit =
      presence.kind === 'data'
        ? { slaveId, via: 'data' }
        : { slaveId, via: 'exception', exceptionCode: presence.exceptionCode };
    hits.push(hit);
    options.onHit?.(hit);
  }

  options.onProgress?.({ done: total, total, label: 'Done' });
  return hits;
}

// --- Address scan -----------------------------------------------------------

export interface AddressScanHit {
  address: number;
  result: ModbusResult;
}

export interface AddressScanOptions extends ScanOptions {
  slaveId: number;
  fc?: ReadFunctionCode;
  from?: number;
  to?: number;
  quantity?: number;
  onHit?: (hit: AddressScanHit) => void;
  /** Give up after this many consecutive silent probes (the device died). */
  abortAfterSilent?: number;
}

/** Walks an address range on one device, recording which addresses read back. */
export async function scanAddresses(
  master: ModbusMaster,
  options: AddressScanOptions,
): Promise<AddressScanHit[]> {
  const fc = options.fc ?? FC.READ_HOLDING_REGISTERS;
  const from = options.from ?? 0;
  const to = options.to ?? 255;
  const quantity = options.quantity ?? 1;
  const abortAfterSilent = options.abortAfterSilent ?? 10;

  const hits: AddressScanHit[] = [];
  const total = to - from + 1;
  let silentRun = 0;

  for (let address = from; address <= to; address++) {
    if (options.signal?.aborted) break;
    options.onProgress?.({ done: address - from, total, label: `Address ${address}` });

    const presence = await probe(master, options.slaveId, fc, address, quantity);

    if (presence.kind === 'silent') {
      // A run of silence means the device stopped talking, not that these
      // addresses are invalid — an absent register answers with an exception.
      if (++silentRun >= abortAfterSilent) break;
      continue;
    }
    silentRun = 0;
    if (presence.kind !== 'data') continue;

    const hit: AddressScanHit = { address, result: presence.result };
    hits.push(hit);
    options.onHit?.(hit);
  }

  options.onProgress?.({ done: total, total, label: 'Done' });
  return hits;
}

export function addressScanToCsv(hits: AddressScanHit[]): string {
  const rows = ['address,values'];
  for (const hit of hits) {
    const values =
      hit.result.kind === 'echo' ? String(hit.result.value) : hit.result.values.join(' ');
    rows.push(`${hit.address},"${values}"`);
  }
  return rows.join('\n');
}

// --- Auto-detect ------------------------------------------------------------

export interface MasterSession {
  master: ModbusMaster;
  close(): Promise<void>;
}

/** Opens a fresh link and master for a candidate set of serial parameters. */
export type MasterOpener = (
  settings: SerialSettings,
  mode: SerialMode,
) => Promise<MasterSession>;

export interface AutoDetectHit {
  settings: SerialSettings;
  mode: SerialMode;
  slaveId: number;
  via: 'data' | 'exception';
}

export interface AutoDetectOptions extends ScanOptions {
  baudRates?: number[];
  parities?: Array<SerialSettings['parity']>;
  modes?: SerialMode[];
  slaveIds?: number[];
  fc?: ReadFunctionCode;
  address?: number;
  onHit?: (hit: AutoDetectHit) => void;
  /** Stop at the first match instead of sweeping everything. */
  stopOnFirst?: boolean;
}

/** Baud rates worth trying first — ordered by how often they show up in the field. */
export const AUTO_DETECT_BAUD_RATES = [9600, 19200, 38400, 115200, 4800, 57600, 2400];

export const AUTO_DETECT_PARITIES: Array<SerialSettings['parity']> = ['none', 'even', 'odd'];

/**
 * Sweeps serial parameters against a range of slave IDs.
 *
 * This is the answer to the most common field problem: the datasheet is gone,
 * somebody changed the settings, and nobody knows the baud rate or slave ID.
 */
export async function autoDetect(
  open: MasterOpener,
  options: AutoDetectOptions = {},
): Promise<AutoDetectHit[]> {
  const baudRates = options.baudRates ?? AUTO_DETECT_BAUD_RATES;
  const parities = options.parities ?? AUTO_DETECT_PARITIES;
  const modes = options.modes ?? (['rtu'] as SerialMode[]);
  const slaveIds = options.slaveIds ?? range(1, 32);
  const fc = options.fc ?? FC.READ_HOLDING_REGISTERS;
  const address = options.address ?? 0;

  const hits: AutoDetectHit[] = [];
  const total = baudRates.length * parities.length * modes.length * slaveIds.length;
  let done = 0;

  for (const mode of modes) {
    for (const baudRate of baudRates) {
      for (const parity of parities) {
        if (options.signal?.aborted) return hits;

        const settings: SerialSettings = { baudRate, dataBits: 8, stopBits: 1, parity };
        let session: MasterSession;
        try {
          session = await open(settings, mode);
        } catch {
          done += slaveIds.length;
          continue;
        }

        try {
          for (const slaveId of slaveIds) {
            if (options.signal?.aborted) return hits;
            options.onProgress?.({
              done,
              total,
              label: `${baudRate} ${parity} ${mode.toUpperCase()} — slave ${slaveId}`,
            });
            done++;

            const presence = await probe(session.master, slaveId, fc, address, 1);
            if (presence.kind === 'silent') continue;

            const hit: AutoDetectHit = {
              settings,
              mode,
              slaveId,
              via: presence.kind === 'data' ? 'data' : 'exception',
            };
            hits.push(hit);
            options.onHit?.(hit);
            if (options.stopOnFirst) return hits;
          }
        } finally {
          await session.close();
        }
      }
    }
  }

  options.onProgress?.({ done: total, total, label: 'Done' });
  return hits;
}

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}
