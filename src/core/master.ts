/**
 * The Modbus master: one transaction at a time, with timeout and retry.
 *
 * A serial line carries a single exchange at a time, so every request is
 * funnelled through an internal queue. Received bytes are collected by a
 * background pump rather than by an ad-hoc read inside each transaction —
 * otherwise a timed-out read would leave an orphaned promise holding bytes
 * that then surface during the *next* exchange and look like a corrupt reply.
 */

import { buildAsciiFrame, parseAsciiFrame } from '../protocol/aduAscii';
import { buildRtuFrame, parseRtuFrame } from '../protocol/aduRtu';
import { ModbusExceptionError, ModbusTransportError } from '../protocol/errors';
import { parseReadResponse, parseWriteResponse } from '../protocol/pdu';
import { createFramer } from '../transport/framer';
import type { SerialLink } from '../transport/link';
import type { ModbusRequest, ModbusResult } from './request';
import { buildRequestPdu, isBroadcast, isReadRequest } from './request';

export type SerialMode = 'rtu' | 'ascii';

export interface MasterOptions {
  mode: SerialMode;
  /** How long to wait for a complete response frame. */
  responseTimeoutMs: number;
  /** Extra attempts after the first failure. 0 means try once. */
  retries: number;
  /** Quiet time enforced between consecutive exchanges. */
  interFrameDelayMs: number;
}

export const DEFAULT_MASTER_OPTIONS: MasterOptions = {
  mode: 'rtu',
  responseTimeoutMs: 1000,
  retries: 0,
  interFrameDelayMs: 10,
};

export interface TrafficEvent {
  direction: 'tx' | 'rx';
  at: number;
  bytes: Uint8Array;
  /** Present on a failed exchange; `bytes` then holds whatever did arrive. */
  error?: string;
}

export interface MasterStats {
  tx: number;
  rx: number;
  errors: number;
  lastResponseMs: number | null;
  minResponseMs: number | null;
  maxResponseMs: number | null;
  avgResponseMs: number | null;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class ModbusMaster {
  private readonly link: SerialLink;
  private readonly onTraffic?: (event: TrafficEvent) => void;
  private options: MasterOptions;

  private rx: number[] = [];
  private notify: (() => void) | null = null;
  private pumping = false;
  private queue: Promise<unknown> = Promise.resolve();

  private txCount = 0;
  private rxCount = 0;
  private errorCount = 0;
  private responseTotal = 0;
  private lastMs: number | null = null;
  private minMs: number | null = null;
  private maxMs: number | null = null;

  constructor(
    link: SerialLink,
    options: MasterOptions = DEFAULT_MASTER_OPTIONS,
    onTraffic?: (event: TrafficEvent) => void,
  ) {
    this.link = link;
    this.options = options;
    this.onTraffic = onTraffic;
    this.startPump();
  }

  setOptions(options: Partial<MasterOptions>): void {
    this.options = { ...this.options, ...options };
  }

  get stats(): MasterStats {
    return {
      tx: this.txCount,
      rx: this.rxCount,
      errors: this.errorCount,
      lastResponseMs: this.lastMs,
      minResponseMs: this.minMs,
      maxResponseMs: this.maxMs,
      avgResponseMs: this.rxCount > 0 ? this.responseTotal / this.rxCount : null,
    };
  }

  resetStats(): void {
    this.txCount = 0;
    this.rxCount = 0;
    this.errorCount = 0;
    this.responseTotal = 0;
    this.lastMs = null;
    this.minMs = null;
    this.maxMs = null;
  }

  /** Queues a transaction. Resolves with the decoded result, or throws. */
  execute(request: ModbusRequest): Promise<ModbusResult> {
    const run = this.queue.then(
      () => this.attempt(request),
      () => this.attempt(request),
    );
    // Keep the chain alive even when a transaction rejects.
    this.queue = run.then(
      () => sleep(this.options.interFrameDelayMs),
      () => sleep(this.options.interFrameDelayMs),
    );
    return run;
  }

  stop(): void {
    this.pumping = false;
    this.notify?.();
  }

  // --- internals ------------------------------------------------------------

  private startPump(): void {
    this.pumping = true;
    void (async () => {
      while (this.pumping) {
        let chunk: Uint8Array | null;
        try {
          chunk = await this.link.read();
        } catch {
          break;
        }
        if (chunk === null) break;
        for (let i = 0; i < chunk.length; i++) this.rx.push(chunk[i]);
        this.notify?.();
      }
      this.pumping = false;
      this.notify?.();
    })();
  }

  private async attempt(request: ModbusRequest): Promise<ModbusResult> {
    const total = Math.max(0, this.options.retries) + 1;
    let lastError: unknown;

    for (let tryIndex = 0; tryIndex < total; tryIndex++) {
      try {
        return await this.transact(request);
      } catch (error) {
        lastError = error;
        // A Modbus exception is a definitive answer from the device — the
        // same request will get the same refusal, so retrying is pointless.
        if (error instanceof ModbusExceptionError) throw error;
        if (tryIndex < total - 1) await sleep(this.options.interFrameDelayMs);
      }
    }
    throw lastError;
  }

  private async transact(request: ModbusRequest): Promise<ModbusResult> {
    if (!this.link.isOpen) throw new ModbusTransportError('PORT_CLOSED');

    const pdu = buildRequestPdu(request);
    const frame =
      this.options.mode === 'rtu'
        ? buildRtuFrame(request.slaveId, pdu)
        : buildAsciiFrame(request.slaveId, pdu);

    // Anything still on the line belongs to a previous exchange.
    this.rx = [];
    this.link.flush();

    const startedAt = Date.now();
    await this.link.write(frame);
    this.txCount++;
    this.onTraffic?.({ direction: 'tx', at: startedAt, bytes: frame });

    if (isBroadcast(request)) {
      // Nobody replies to a broadcast; report the echo of what we asked for.
      return { kind: 'echo', address: request.address, value: 0 };
    }

    const framer = createFramer(this.options.mode, request.fc);
    const deadline = startedAt + this.options.responseTimeoutMs;

    for (;;) {
      if (this.rx.length > 0) {
        framer.push(Uint8Array.from(this.rx));
        this.rx = [];
      }

      const raw = framer.take();
      if (raw) {
        const elapsed = Date.now() - startedAt;
        try {
          const result = this.decode(raw, request);
          this.recordSuccess(elapsed);
          this.onTraffic?.({ direction: 'rx', at: Date.now(), bytes: raw });
          return result;
        } catch (error) {
          this.errorCount++;
          this.onTraffic?.({
            direction: 'rx',
            at: Date.now(),
            bytes: raw,
            error: error instanceof Error ? error.message : String(error),
          });
          throw error;
        }
      }

      if (!(await this.waitForBytes(deadline))) {
        this.errorCount++;
        const partial = framer.buffered;
        const error =
          partial.length > 0
            ? new ModbusTransportError('SHORT_FRAME', `${partial.length} bytes before timeout`)
            : new ModbusTransportError('TIMEOUT');
        this.onTraffic?.({
          direction: 'rx',
          at: Date.now(),
          bytes: partial,
          error: error.message,
        });
        throw error;
      }
    }
  }

  private decode(raw: Uint8Array, request: ModbusRequest): ModbusResult {
    const { slaveId, pdu } =
      this.options.mode === 'rtu' ? parseRtuFrame(raw) : parseAsciiFrame(raw);

    if (slaveId !== request.slaveId) {
      throw new ModbusTransportError(
        'SLAVE_MISMATCH',
        `asked ${request.slaveId}, heard ${slaveId}`,
      );
    }

    if (isReadRequest(request)) {
      return parseReadResponse(pdu, request.fc, request.quantity);
    }
    return { kind: 'echo', ...parseWriteResponse(pdu, request.fc) };
  }

  /** Resolves true when new bytes arrived, false on deadline or a dead link. */
  private waitForBytes(deadline: number): Promise<boolean> {
    if (this.rx.length > 0) return Promise.resolve(true);
    if (!this.pumping) return Promise.resolve(false);

    const remaining = deadline - Date.now();
    if (remaining <= 0) return Promise.resolve(false);

    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => finish(false), remaining);
      const finish = (ok: boolean) => {
        clearTimeout(timer);
        this.notify = null;
        resolve(ok);
      };
      this.notify = () => finish(this.rx.length > 0);
    });
  }

  private recordSuccess(elapsed: number): void {
    this.rxCount++;
    this.responseTotal += elapsed;
    this.lastMs = elapsed;
    this.minMs = this.minMs === null ? elapsed : Math.min(this.minMs, elapsed);
    this.maxMs = this.maxMs === null ? elapsed : Math.max(this.maxMs, elapsed);
  }
}
