/**
 * Round-robin polling across every open definition.
 *
 * Mirrors how Modbus Poll works: one shared connection, many definitions, each
 * with its own scan rate. The scheduler always services whichever definition
 * has been waiting longest, so a fast definition cannot starve a slow one.
 */

import { ModbusExceptionError, ModbusTransportError } from '../protocol/errors';
import type { ModbusMaster } from './master';
import type { ModbusResult, ReadRequest } from './request';

export type ReadFunctionCode = ReadRequest['fc'];

export interface PollDefinition {
  id: string;
  name: string;
  slaveId: number;
  fc: ReadFunctionCode;
  address: number;
  quantity: number;
  /** 0 means poll as fast as the line allows. */
  scanRateMs: number;
  enabled: boolean;
  /** Stop polling this definition after the first failure. */
  disableOnError: boolean;
}

export interface PollFailure {
  message: string;
  hint: string;
  /** Set when the device answered with a Modbus exception. */
  exceptionCode?: number;
}

export interface PollUpdate {
  definitionId: string;
  at: number;
  result: ModbusResult | null;
  error: PollFailure | null;
  /** Failures in a row; reset to 0 by a successful poll. */
  consecutiveErrors: number;
}

interface Entry {
  definition: PollDefinition;
  dueAt: number;
  consecutiveErrors: number;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Cap on how long the loop sleeps, so edits take effect promptly. */
const MAX_IDLE_MS = 50;

export class PollScheduler {
  private readonly master: ModbusMaster;
  private readonly onUpdate: (update: PollUpdate) => void;
  private entries = new Map<string, Entry>();
  private running = false;
  private loopPromise: Promise<void> | null = null;

  constructor(master: ModbusMaster, onUpdate: (update: PollUpdate) => void) {
    this.master = master;
    this.onUpdate = onUpdate;
  }

  get isRunning(): boolean {
    return this.running;
  }

  get definitions(): PollDefinition[] {
    return [...this.entries.values()].map((entry) => entry.definition);
  }

  /** Adds a definition, or replaces one with the same id. */
  set(definition: PollDefinition): void {
    const existing = this.entries.get(definition.id);
    this.entries.set(definition.id, {
      definition,
      // A re-enabled or edited definition should poll immediately.
      dueAt: existing && sameTiming(existing.definition, definition) ? existing.dueAt : 0,
      consecutiveErrors: existing?.consecutiveErrors ?? 0,
    });
  }

  remove(id: string): void {
    this.entries.delete(id);
  }

  clear(): void {
    this.entries.clear();
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    for (const entry of this.entries.values()) entry.dueAt = 0;
    this.loopPromise = this.loop();
  }

  /** Stops scheduling. Resolves once the in-flight poll has settled. */
  async stop(): Promise<void> {
    this.running = false;
    await this.loopPromise;
    this.loopPromise = null;
  }

  /** Runs every enabled definition exactly once (Modbus Poll's F6). */
  async pollOnce(): Promise<void> {
    for (const entry of this.entries.values()) {
      if (!entry.definition.enabled) continue;
      await this.poll(entry);
    }
  }

  private async loop(): Promise<void> {
    while (this.running) {
      const entry = this.nextDue();
      if (!entry) {
        await sleep(MAX_IDLE_MS);
        continue;
      }
      const wait = entry.dueAt - Date.now();
      if (wait > 0) {
        await sleep(Math.min(wait, MAX_IDLE_MS));
        continue;
      }
      await this.poll(entry);
    }
  }

  /** The enabled definition that has been waiting longest. */
  private nextDue(): Entry | null {
    let best: Entry | null = null;
    for (const entry of this.entries.values()) {
      if (!entry.definition.enabled) continue;
      if (!best || entry.dueAt < best.dueAt) best = entry;
    }
    return best;
  }

  private async poll(entry: Entry): Promise<void> {
    const { definition } = entry;
    try {
      const result = await this.master.execute({
        fc: definition.fc,
        slaveId: definition.slaveId,
        address: definition.address,
        quantity: definition.quantity,
      });
      entry.consecutiveErrors = 0;
      this.emit(definition.id, result, null, 0);
    } catch (error) {
      entry.consecutiveErrors++;
      if (definition.disableOnError) {
        entry.definition = { ...definition, enabled: false };
      }
      this.emit(definition.id, null, describe(error), entry.consecutiveErrors);
    } finally {
      entry.dueAt = Date.now() + Math.max(0, definition.scanRateMs);
    }
  }

  private emit(
    definitionId: string,
    result: ModbusResult | null,
    error: PollFailure | null,
    consecutiveErrors: number,
  ): void {
    this.onUpdate({ definitionId, at: Date.now(), result, error, consecutiveErrors });
  }
}

function sameTiming(a: PollDefinition, b: PollDefinition): boolean {
  return (
    a.slaveId === b.slaveId &&
    a.fc === b.fc &&
    a.address === b.address &&
    a.quantity === b.quantity &&
    a.scanRateMs === b.scanRateMs &&
    a.enabled === b.enabled
  );
}

export function describe(error: unknown): PollFailure {
  if (error instanceof ModbusExceptionError) {
    return { message: error.message, hint: error.hint, exceptionCode: error.exceptionCode };
  }
  if (error instanceof ModbusTransportError) {
    return { message: error.message, hint: error.hint };
  }
  return { message: error instanceof Error ? error.message : String(error), hint: '' };
}
