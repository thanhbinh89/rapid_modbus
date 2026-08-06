/**
 * Modbus RTU framing: slave address + PDU + CRC (low byte first).
 */

import { checkCrc16, crc16Bytes } from './crc16';
import { ModbusTransportError } from './errors';

export function buildRtuFrame(slaveId: number, pdu: Uint8Array): Uint8Array {
  if (!Number.isInteger(slaveId) || slaveId < 0 || slaveId > 255) {
    throw new RangeError(`Slave ID must be 0..255, got ${slaveId}`);
  }
  const body = new Uint8Array(1 + pdu.length);
  body[0] = slaveId;
  body.set(pdu, 1);

  const [lo, hi] = crc16Bytes(body);
  const frame = new Uint8Array(body.length + 2);
  frame.set(body, 0);
  frame[body.length] = lo;
  frame[body.length + 1] = hi;
  return frame;
}

export function parseRtuFrame(frame: Uint8Array): { slaveId: number; pdu: Uint8Array } {
  if (frame.length < 4) {
    throw new ModbusTransportError('SHORT_FRAME', `RTU frame is ${frame.length} bytes`);
  }
  if (!checkCrc16(frame)) {
    throw new ModbusTransportError('CRC_ERROR');
  }
  return {
    slaveId: frame[0],
    pdu: frame.subarray(1, frame.length - 2),
  };
}
