/**
 * LRC checksum for Modbus ASCII.
 *
 * The LRC is the two's complement of the 8-bit sum of every byte in the
 * message, excluding the leading ':' and the trailing CRLF.
 */

export function lrc(data: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    sum = (sum + data[i]) & 0xff;
  }
  return (-sum) & 0xff;
}

/** A frame is valid when its bytes plus the trailing LRC sum to 0. */
export function checkLrc(frameWithLrc: Uint8Array): boolean {
  if (frameWithLrc.length < 2) return false;
  let sum = 0;
  for (let i = 0; i < frameWithLrc.length; i++) {
    sum = (sum + frameWithLrc[i]) & 0xff;
  }
  return sum === 0;
}
