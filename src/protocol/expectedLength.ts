/**
 * Expected RTU response length.
 *
 * Web Serial hands us bytes in arbitrary chunks — chunk boundaries are not
 * frame boundaries, and JS timers are too coarse to detect the t3.5 silent
 * interval reliably. Since we are always the master, we know what we asked
 * for, so we can derive the exact frame length from the first few bytes and
 * stop reading there. The t3.5 timer is only a fallback for flushing garbage.
 */

import { FC } from './pdu';

/** Longest possible RTU frame: 1 addr + 253 PDU + 2 CRC. */
export const MAX_RTU_FRAME = 256;

/** An exception response is always addr + fc + code + 2 CRC. */
export const EXCEPTION_FRAME_LENGTH = 5;

/** Write responses (05, 06, 15, 16) are addr + fc + 4 data + 2 CRC. */
export const WRITE_RESPONSE_LENGTH = 8;

/**
 * How many bytes the response frame will occupy in total, or `null` when more
 * bytes are needed before the length can be determined.
 *
 * @param buf     bytes received so far, starting at the slave address
 * @param requestFc the function code we sent
 */
export function expectedRtuResponseLength(buf: Uint8Array, requestFc: number): number | null {
  // Need the slave address and function code before anything can be decided.
  if (buf.length < 2) return null;

  // Exception responses short-circuit every function code.
  if ((buf[1] & 0x80) !== 0) return EXCEPTION_FRAME_LENGTH;

  switch (requestFc) {
    case FC.READ_COILS:
    case FC.READ_DISCRETE_INPUTS:
    case FC.READ_HOLDING_REGISTERS:
    case FC.READ_INPUT_REGISTERS: {
      // addr + fc + byteCount + data + 2 CRC
      if (buf.length < 3) return null;
      return 3 + buf[2] + 2;
    }
    case FC.WRITE_SINGLE_COIL:
    case FC.WRITE_SINGLE_REGISTER:
    case FC.WRITE_MULTIPLE_COILS:
    case FC.WRITE_MULTIPLE_REGISTERS:
      return WRITE_RESPONSE_LENGTH;
    default:
      return null;
  }
}

/**
 * The t3.5 inter-frame silence in milliseconds.
 *
 * Below 19200 baud the spec derives it from the character time; at or above
 * 19200 it is fixed at 1.75 ms. We floor the result so a timer still has
 * something to work with on a platform with millisecond resolution.
 */
export function t35Millis(baudRate: number, bitsPerChar = 11): number {
  if (baudRate >= 19200) return 1.75;
  return (bitsPerChar * 3.5 * 1000) / baudRate;
}
