/**
 * A simulated Modbus line for tests.
 *
 * Hosts zero or more fake slave devices and can misbehave on purpose —
 * silence, wrong CRC, exception replies, responses dribbled out in tiny
 * chunks — which is what the master actually has to survive in the field.
 *
 * Test-only; nothing in the app imports it.
 */

import { buildAsciiFrame, parseAsciiFrame } from '../protocol/aduAscii';
import { buildRtuFrame, parseRtuFrame } from '../protocol/aduRtu';
import { FC } from '../protocol/pdu';
import type { SerialLink } from '../transport/link';

export interface FakeDeviceOptions {
  slaveId: number;
  holdingRegisters?: number[];
  inputRegisters?: number[];
  coils?: boolean[];
  discreteInputs?: boolean[];
  /** Reply with this Modbus exception code instead of data. */
  exceptionCode?: number;
  /** Stay silent — simulates a device that is absent or on the wrong baud. */
  silent?: boolean;
  /** Milliseconds before the reply appears on the line. */
  responseDelayMs?: number;
  /** Emit the reply in chunks of this size instead of all at once. */
  chunkSize?: number;
  /** Corrupt the checksum, as line noise or a baud mismatch would. */
  corruptChecksum?: boolean;
}

export class FakeDevice {
  readonly options: FakeDeviceOptions;
  holdingRegisters: number[];
  coils: boolean[];

  constructor(options: FakeDeviceOptions) {
    this.options = options;
    this.holdingRegisters = [...(options.holdingRegisters ?? [])];
    this.coils = [...(options.coils ?? [])];
  }

  /** Returns the response PDU, or null to stay silent. */
  respond(pdu: Uint8Array): Uint8Array | null {
    if (this.options.silent) return null;

    const fc = pdu[0];
    if (this.options.exceptionCode !== undefined) {
      return Uint8Array.from([fc | 0x80, this.options.exceptionCode]);
    }

    const address = (pdu[1] << 8) | pdu[2];

    switch (fc) {
      case FC.READ_HOLDING_REGISTERS:
      case FC.READ_INPUT_REGISTERS: {
        const quantity = (pdu[3] << 8) | pdu[4];
        const source =
          fc === FC.READ_HOLDING_REGISTERS
            ? this.holdingRegisters
            : (this.options.inputRegisters ?? []);
        const values = readRange(source, address, quantity);
        if (!values) return Uint8Array.from([fc | 0x80, 0x02]);
        const data: number[] = [];
        for (const value of values) data.push((value >>> 8) & 0xff, value & 0xff);
        return Uint8Array.from([fc, data.length, ...data]);
      }

      case FC.READ_COILS:
      case FC.READ_DISCRETE_INPUTS: {
        const quantity = (pdu[3] << 8) | pdu[4];
        const source = fc === FC.READ_COILS ? this.coils : (this.options.discreteInputs ?? []);
        const values = readRange(source, address, quantity);
        if (!values) return Uint8Array.from([fc | 0x80, 0x02]);
        const byteCount = Math.ceil(quantity / 8);
        const data = new Uint8Array(byteCount);
        values.forEach((on, i) => {
          if (on) data[i >> 3] |= 1 << i % 8;
        });
        return Uint8Array.from([fc, byteCount, ...data]);
      }

      case FC.WRITE_SINGLE_COIL: {
        this.coils[address] = pdu[3] === 0xff;
        return pdu.slice(0, 5);
      }

      case FC.WRITE_SINGLE_REGISTER: {
        this.holdingRegisters[address] = (pdu[3] << 8) | pdu[4];
        return pdu.slice(0, 5);
      }

      case FC.WRITE_MULTIPLE_COILS: {
        const quantity = (pdu[3] << 8) | pdu[4];
        for (let i = 0; i < quantity; i++) {
          this.coils[address + i] = (pdu[6 + (i >> 3)] & (1 << i % 8)) !== 0;
        }
        return Uint8Array.from([fc, pdu[1], pdu[2], pdu[3], pdu[4]]);
      }

      case FC.WRITE_MULTIPLE_REGISTERS: {
        const quantity = (pdu[3] << 8) | pdu[4];
        for (let i = 0; i < quantity; i++) {
          this.holdingRegisters[address + i] = (pdu[6 + i * 2] << 8) | pdu[7 + i * 2];
        }
        return Uint8Array.from([fc, pdu[1], pdu[2], pdu[3], pdu[4]]);
      }

      default:
        return Uint8Array.from([fc | 0x80, 0x01]);
    }
  }
}

function readRange<T>(source: T[], address: number, quantity: number): T[] | null {
  if (address + quantity > source.length) return null;
  return source.slice(address, address + quantity);
}

export class FakeSerialLink implements SerialLink {
  isOpen = true;
  /** Every frame the master wrote, in order. */
  readonly written: Uint8Array[] = [];

  private readonly devices: FakeDevice[];
  private readonly mode: 'rtu' | 'ascii';
  private chunks: Uint8Array[] = [];
  private waiters: Array<(value: Uint8Array | null) => void> = [];
  private timers: Array<ReturnType<typeof setTimeout>> = [];

  constructor(devices: FakeDevice[], mode: 'rtu' | 'ascii' = 'rtu') {
    this.devices = devices;
    this.mode = mode;
  }

  write(data: Uint8Array): Promise<void> {
    this.written.push(data.slice());

    let slaveId: number;
    let pdu: Uint8Array;
    try {
      const parsed = this.mode === 'rtu' ? parseRtuFrame(data) : parseAsciiFrame(data);
      slaveId = parsed.slaveId;
      pdu = parsed.pdu;
    } catch {
      return Promise.resolve();
    }

    // Broadcasts are acted on but never answered.
    if (slaveId === 0) return Promise.resolve();

    const device = this.devices.find((d) => d.options.slaveId === slaveId);
    if (!device) return Promise.resolve();

    const responsePdu = device.respond(pdu);
    if (!responsePdu) return Promise.resolve();

    let frame =
      this.mode === 'rtu'
        ? buildRtuFrame(slaveId, responsePdu)
        : buildAsciiFrame(slaveId, responsePdu);

    if (device.options.corruptChecksum) {
      frame = frame.slice();
      frame[frame.length - 1] ^= 0xff;
    }

    const emit = () => this.emit(frame, device.options.chunkSize);
    const delay = device.options.responseDelayMs ?? 0;
    if (delay > 0) {
      this.timers.push(setTimeout(emit, delay));
    } else {
      emit();
    }
    return Promise.resolve();
  }

  read(): Promise<Uint8Array | null> {
    if (!this.isOpen) return Promise.resolve(null);
    const next = this.chunks.shift();
    if (next) return Promise.resolve(next);
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  flush(): void {
    this.chunks = [];
  }

  close(): Promise<void> {
    this.isOpen = false;
    for (const timer of this.timers) clearTimeout(timer);
    this.timers = [];
    for (const waiter of this.waiters) waiter(null);
    this.waiters = [];
    return Promise.resolve();
  }

  private emit(frame: Uint8Array, chunkSize?: number): void {
    const size = chunkSize && chunkSize > 0 ? chunkSize : frame.length;
    for (let offset = 0; offset < frame.length; offset += size) {
      this.deliver(frame.slice(offset, offset + size));
    }
  }

  private deliver(chunk: Uint8Array): void {
    const waiter = this.waiters.shift();
    if (waiter) waiter(chunk);
    else this.chunks.push(chunk);
  }
}
