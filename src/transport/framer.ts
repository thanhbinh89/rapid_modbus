/**
 * Turning an arbitrary byte stream back into Modbus frames.
 *
 * Web Serial hands us chunks whose boundaries have nothing to do with frame
 * boundaries, so a framer accumulates bytes and reports when a whole frame is
 * present. One framer instance handles one transaction: RTU needs to know the
 * request's function code to derive the expected length, and both modes want a
 * clean buffer per exchange.
 */

import { expectedRtuResponseLength } from '../protocol/expectedLength';

export interface Framer {
  /** Appends received bytes. */
  push(chunk: Uint8Array): void;
  /**
   * Returns a complete frame once one is buffered, otherwise `null`.
   * The frame is removed from the buffer.
   */
  take(): Uint8Array | null;
  /** Bytes currently held, useful for reporting a truncated response. */
  readonly buffered: Uint8Array;
  reset(): void;
}

abstract class BufferedFramer implements Framer {
  protected buf: number[] = [];

  push(chunk: Uint8Array): void {
    for (let i = 0; i < chunk.length; i++) this.buf.push(chunk[i]);
  }

  get buffered(): Uint8Array {
    return Uint8Array.from(this.buf);
  }

  reset(): void {
    this.buf = [];
  }

  abstract take(): Uint8Array | null;
}

/**
 * RTU framing driven by the expected response length.
 *
 * We are always the master, so the request's function code plus the first few
 * response bytes pin down the frame length exactly. This is far more reliable
 * than trying to detect the t3.5 silent interval from JavaScript.
 */
export class RtuFramer extends BufferedFramer {
  private readonly requestFc: number;

  constructor(requestFc: number) {
    super();
    this.requestFc = requestFc;
  }

  take(): Uint8Array | null {
    const expected = expectedRtuResponseLength(this.buffered, this.requestFc);
    if (expected === null || this.buf.length < expected) return null;
    const frame = Uint8Array.from(this.buf.slice(0, expected));
    this.buf = this.buf.slice(expected);
    return frame;
  }
}

const COLON = 0x3a;
const CR = 0x0d;
const LF = 0x0a;

/**
 * ASCII framing is delimiter-bounded: ':' starts a frame, CRLF ends it.
 * Anything before the ':' is line noise and gets dropped.
 */
export class AsciiFramer extends BufferedFramer {
  take(): Uint8Array | null {
    const start = this.buf.indexOf(COLON);
    if (start === -1) {
      // Nothing usable buffered; keep only the tail in case ':' is next.
      this.buf = [];
      return null;
    }
    if (start > 0) this.buf = this.buf.slice(start);

    for (let i = 1; i < this.buf.length; i++) {
      if (this.buf[i - 1] === CR && this.buf[i] === LF) {
        const frame = Uint8Array.from(this.buf.slice(0, i + 1));
        this.buf = this.buf.slice(i + 1);
        return frame;
      }
    }
    return null;
  }
}

export function createFramer(mode: 'rtu' | 'ascii', requestFc: number): Framer {
  return mode === 'rtu' ? new RtuFramer(requestFc) : new AsciiFramer();
}
