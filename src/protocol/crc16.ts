/**
 * CRC-16/MODBUS.
 *
 * Poly 0xA001 (reflected 0x8005), init 0xFFFF, no final XOR.
 * On the wire the checksum is appended low byte first.
 */

const CRC_TABLE: Uint16Array = (() => {
  const table = new Uint16Array(256);
  for (let i = 0; i < 256; i++) {
    let crc = i;
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xa001 : crc >>> 1;
    }
    table[i] = crc;
  }
  return table;
})();

/** Returns the CRC as a 16-bit number (not byte-swapped). */
export function crc16(data: Uint8Array): number {
  let crc = 0xffff;
  for (let i = 0; i < data.length; i++) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ data[i]) & 0xff];
  }
  return crc;
}

/** The two CRC bytes in transmission order: low byte, then high byte. */
export function crc16Bytes(data: Uint8Array): [number, number] {
  const crc = crc16(data);
  return [crc & 0xff, (crc >>> 8) & 0xff];
}

/**
 * Validates a complete RTU frame (payload + trailing CRC).
 * A frame is valid when the CRC over the whole frame, checksum included, is 0.
 */
export function checkCrc16(frame: Uint8Array): boolean {
  if (frame.length < 3) return false;
  return crc16(frame) === 0;
}
