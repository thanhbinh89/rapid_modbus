/**
 * SerialLink backed by the Web Serial API.
 *
 * This is the only file in the codebase that touches `navigator.serial`, which
 * keeps every layer above it testable without a browser or a device attached.
 */

import { ModbusTransportError } from '../protocol/errors';
import type { SerialLink, SerialSettings } from './link';

export function isWebSerialSupported(): boolean {
  return typeof navigator !== 'undefined' && 'serial' in navigator;
}

/**
 * Why Web Serial is unavailable, phrased for someone standing at a control
 * panel rather than reading a spec.
 */
export function webSerialUnavailableReason(): string | null {
  if (typeof navigator === 'undefined') return 'Not running in a browser.';
  if (!('serial' in navigator)) {
    return (
      'This browser does not support the Web Serial API. ' +
      'Use Chrome, Edge or Opera on desktop — Safari and Firefox do not support it.'
    );
  }
  if (typeof window !== 'undefined' && !window.isSecureContext) {
    return 'Web Serial requires HTTPS or localhost. This page is not a secure context.';
  }
  return null;
}

/** Prompts the user to pick a port. Must be called from a user gesture. */
export function requestPort(filters?: SerialPortFilter[]): Promise<SerialPort> {
  if (!isWebSerialSupported()) {
    throw new ModbusTransportError('PORT_CLOSED', webSerialUnavailableReason() ?? 'no Web Serial');
  }
  return navigator.serial.requestPort(filters ? { filters } : undefined);
}

/**
 * Ports the user has already granted access to. Lets a returning session
 * reconnect in one click instead of re-prompting.
 */
export function getGrantedPorts(): Promise<SerialPort[]> {
  if (!isWebSerialSupported()) return Promise.resolve([]);
  return navigator.serial.getPorts();
}

/** A human-readable name for a port, since Web Serial exposes no label. */
export function describePort(port: SerialPort, index = 0): string {
  const info = port.getInfo();
  if (info.usbVendorId !== undefined && info.usbProductId !== undefined) {
    const vid = info.usbVendorId.toString(16).padStart(4, '0').toUpperCase();
    const pid = info.usbProductId.toString(16).padStart(4, '0').toUpperCase();
    return `USB ${vid}:${pid}`;
  }
  return `Serial port ${index + 1}`;
}

export class WebSerialLink implements SerialLink {
  private readonly port: SerialPort;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private pending: Uint8Array[] = [];
  private open = false;

  private constructor(port: SerialPort) {
    this.port = port;
  }

  static async open(port: SerialPort, settings: SerialSettings): Promise<WebSerialLink> {
    await port.open({
      baudRate: settings.baudRate,
      dataBits: settings.dataBits,
      stopBits: settings.stopBits,
      parity: settings.parity,
      flowControl: 'none',
    });

    const link = new WebSerialLink(port);
    if (!port.readable || !port.writable) {
      await port.close();
      throw new ModbusTransportError('PORT_CLOSED', 'port opened without readable/writable streams');
    }
    link.reader = port.readable.getReader();
    link.writer = port.writable.getWriter();
    link.open = true;
    return link;
  }

  get isOpen(): boolean {
    return this.open;
  }

  async write(data: Uint8Array): Promise<void> {
    if (!this.writer) throw new ModbusTransportError('PORT_CLOSED');
    await this.writer.write(data);
  }

  async read(): Promise<Uint8Array | null> {
    const queued = this.pending.shift();
    if (queued) return queued;
    if (!this.reader) return null;

    const { value, done } = await this.reader.read();
    if (done) {
      this.open = false;
      return null;
    }
    return value ?? new Uint8Array(0);
  }

  flush(): void {
    this.pending = [];
  }

  async close(): Promise<void> {
    this.open = false;
    this.pending = [];

    // Cancel before releasing: a pending read() keeps the lock otherwise.
    if (this.reader) {
      try {
        await this.reader.cancel();
      } catch {
        // The port may already be gone (cable pulled); nothing to salvage.
      }
      this.reader.releaseLock();
      this.reader = null;
    }
    if (this.writer) {
      try {
        await this.writer.close();
      } catch {
        // Same as above.
      }
      this.writer = null;
    }
    try {
      await this.port.close();
    } catch {
      // Already closed.
    }
  }
}

/**
 * Fires when a port physically disappears — almost always the USB adapter
 * being unplugged, which should stop polling immediately rather than pile up
 * timeouts.
 */
export function onPortDisconnect(handler: (port: SerialPort) => void): () => void {
  if (!isWebSerialSupported()) return () => {};
  const listener = (event: Event) => {
    handler((event as unknown as { target: SerialPort }).target);
  };
  navigator.serial.addEventListener('disconnect', listener);
  return () => navigator.serial.removeEventListener('disconnect', listener);
}
