import { describe, expect, it } from 'vitest';
import { buildAsciiFrame } from '../protocol/aduAscii';
import { buildRtuFrame } from '../protocol/aduRtu';
import { FC } from '../protocol/pdu';
import { AsciiFramer, RtuFramer, createFramer } from './framer';

function bytes(...values: number[]): Uint8Array {
  return Uint8Array.from(values);
}

/** A read-holding-registers response carrying 3 registers. */
const RTU_READ_RESPONSE = buildRtuFrame(
  0x01,
  bytes(0x03, 0x06, 0x02, 0x2b, 0x00, 0x00, 0x00, 0x64),
);

describe('RtuFramer', () => {
  it('returns null until the whole frame has arrived', () => {
    const framer = new RtuFramer(FC.READ_HOLDING_REGISTERS);
    for (let i = 0; i < RTU_READ_RESPONSE.length - 1; i++) {
      framer.push(RTU_READ_RESPONSE.subarray(i, i + 1));
      expect(framer.take()).toBeNull();
    }
    framer.push(RTU_READ_RESPONSE.subarray(RTU_READ_RESPONSE.length - 1));
    expect(framer.take()).toEqual(RTU_READ_RESPONSE);
  });

  it('reassembles the frame however the stream is chopped up', () => {
    // Every possible split point must produce the identical frame — this is
    // the property that actually matters, since Web Serial chunk boundaries
    // are arbitrary.
    for (let split = 0; split <= RTU_READ_RESPONSE.length; split++) {
      const framer = new RtuFramer(FC.READ_HOLDING_REGISTERS);
      framer.push(RTU_READ_RESPONSE.subarray(0, split));
      framer.push(RTU_READ_RESPONSE.subarray(split));
      expect(framer.take(), `split at ${split}`).toEqual(RTU_READ_RESPONSE);
    }
  });

  it('handles a frame delivered in one chunk', () => {
    const framer = new RtuFramer(FC.READ_HOLDING_REGISTERS);
    framer.push(RTU_READ_RESPONSE);
    expect(framer.take()).toEqual(RTU_READ_RESPONSE);
    expect(framer.take()).toBeNull();
  });

  it('frames a 5-byte exception response', () => {
    const exception = buildRtuFrame(0x01, bytes(0x83, 0x02));
    const framer = new RtuFramer(FC.READ_HOLDING_REGISTERS);
    framer.push(exception);
    expect(framer.take()).toEqual(exception);
    expect(exception.length).toBe(5);
  });

  it('frames a fixed-length write response', () => {
    const echo = buildRtuFrame(0x01, bytes(0x06, 0x00, 0x01, 0x00, 0x03));
    const framer = new RtuFramer(FC.WRITE_SINGLE_REGISTER);
    framer.push(echo);
    expect(framer.take()).toEqual(echo);
    expect(echo.length).toBe(8);
  });

  it('keeps trailing bytes buffered instead of swallowing them', () => {
    const framer = new RtuFramer(FC.WRITE_SINGLE_REGISTER);
    const echo = buildRtuFrame(0x01, bytes(0x06, 0x00, 0x01, 0x00, 0x03));
    framer.push(echo);
    framer.push(bytes(0xaa, 0xbb));
    expect(framer.take()).toEqual(echo);
    expect(framer.buffered).toEqual(bytes(0xaa, 0xbb));
  });

  it('exposes what it holds so a timeout can report a truncated response', () => {
    const framer = new RtuFramer(FC.READ_HOLDING_REGISTERS);
    framer.push(bytes(0x01, 0x03, 0x06, 0x02));
    expect(framer.take()).toBeNull();
    expect(framer.buffered).toEqual(bytes(0x01, 0x03, 0x06, 0x02));
  });

  it('clears on reset', () => {
    const framer = new RtuFramer(FC.READ_HOLDING_REGISTERS);
    framer.push(bytes(0x01, 0x03, 0x06));
    framer.reset();
    expect(framer.buffered).toEqual(new Uint8Array(0));
  });
});

describe('AsciiFramer', () => {
  const asciiResponse = buildAsciiFrame(0x01, bytes(0x03, 0x02, 0x00, 0x64));

  it('reassembles however the stream is chopped up', () => {
    for (let split = 0; split <= asciiResponse.length; split++) {
      const framer = new AsciiFramer();
      framer.push(asciiResponse.subarray(0, split));
      framer.push(asciiResponse.subarray(split));
      expect(framer.take(), `split at ${split}`).toEqual(asciiResponse);
    }
  });

  it('returns null before the CRLF terminator arrives', () => {
    const framer = new AsciiFramer();
    framer.push(asciiResponse.subarray(0, asciiResponse.length - 1));
    expect(framer.take()).toBeNull();
  });

  it('drops line noise before the leading colon', () => {
    const framer = new AsciiFramer();
    framer.push(bytes(0x00, 0xff, 0x7f));
    framer.push(asciiResponse);
    expect(framer.take()).toEqual(asciiResponse);
  });

  it('discards a buffer with no colon at all', () => {
    const framer = new AsciiFramer();
    framer.push(bytes(0x00, 0xff));
    expect(framer.take()).toBeNull();
    expect(framer.buffered).toEqual(new Uint8Array(0));
  });

  it('separates two back-to-back frames', () => {
    const framer = new AsciiFramer();
    framer.push(asciiResponse);
    framer.push(asciiResponse);
    expect(framer.take()).toEqual(asciiResponse);
    expect(framer.take()).toEqual(asciiResponse);
    expect(framer.take()).toBeNull();
  });
});

describe('createFramer', () => {
  it('picks the framer that matches the mode', () => {
    expect(createFramer('rtu', FC.READ_HOLDING_REGISTERS)).toBeInstanceOf(RtuFramer);
    expect(createFramer('ascii', FC.READ_HOLDING_REGISTERS)).toBeInstanceOf(AsciiFramer);
  });
});
