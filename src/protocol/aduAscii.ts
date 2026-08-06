/**
 * Modbus ASCII framing: ':' + hex(address + PDU + LRC) + CRLF.
 *
 * Unlike RTU, ASCII frames are delimiter-bounded, so the reader can simply
 * scan for CRLF instead of computing an expected length.
 */

import { ModbusTransportError } from './errors';
import { checkLrc, lrc } from './lrc';

const COLON = 0x3a;
const CR = 0x0d;
const LF = 0x0a;

function toHexByte(value: number): string {
  return value.toString(16).toUpperCase().padStart(2, '0');
}

export function buildAsciiFrame(slaveId: number, pdu: Uint8Array): Uint8Array {
  if (!Number.isInteger(slaveId) || slaveId < 0 || slaveId > 255) {
    throw new RangeError(`Slave ID must be 0..255, got ${slaveId}`);
  }
  const body = new Uint8Array(1 + pdu.length);
  body[0] = slaveId;
  body.set(pdu, 1);

  let text = ':';
  for (let i = 0; i < body.length; i++) text += toHexByte(body[i]);
  text += toHexByte(lrc(body));

  const out = new Uint8Array(text.length + 2);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i);
  out[text.length] = CR;
  out[text.length + 1] = LF;
  return out;
}

export function parseAsciiFrame(frame: Uint8Array): { slaveId: number; pdu: Uint8Array } {
  if (frame.length < 4 || frame[0] !== COLON) {
    throw new ModbusTransportError('MALFORMED_FRAME', 'ASCII frame must start with ":"');
  }

  // Trim the CRLF terminator if present.
  let end = frame.length;
  if (end >= 2 && frame[end - 2] === CR && frame[end - 1] === LF) end -= 2;

  const hex = frame.subarray(1, end);
  if (hex.length % 2 !== 0) {
    throw new ModbusTransportError('MALFORMED_FRAME', 'odd number of hex characters');
  }

  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    const pair = String.fromCharCode(hex[i * 2], hex[i * 2 + 1]);
    const value = Number.parseInt(pair, 16);
    if (Number.isNaN(value)) {
      throw new ModbusTransportError('MALFORMED_FRAME', `bad hex pair "${pair}"`);
    }
    bytes[i] = value;
  }

  if (bytes.length < 3) {
    throw new ModbusTransportError('SHORT_FRAME', `ASCII frame decodes to ${bytes.length} bytes`);
  }
  if (!checkLrc(bytes)) {
    throw new ModbusTransportError('LRC_ERROR');
  }

  return {
    slaveId: bytes[0],
    pdu: bytes.subarray(1, bytes.length - 1),
  };
}
