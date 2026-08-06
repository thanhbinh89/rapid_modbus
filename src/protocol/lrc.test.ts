import { describe, expect, it } from 'vitest';
import { checkLrc, lrc } from './lrc';

describe('lrc', () => {
  it('returns the two’s complement of the byte sum', () => {
    // 01 + 03 + 00 + 00 + 00 + 01 = 0x05 -> LRC 0xFB
    const body = Uint8Array.from([0x01, 0x03, 0x00, 0x00, 0x00, 0x01]);
    expect(lrc(body)).toBe(0xfb);
  });

  it('wraps around on overflow', () => {
    expect(lrc(Uint8Array.from([0xff, 0xff]))).toBe(0x02);
  });

  it('validates a body plus its trailing LRC', () => {
    expect(checkLrc(Uint8Array.from([0x01, 0x03, 0x00, 0x00, 0x00, 0x01, 0xfb]))).toBe(true);
  });

  it('rejects a corrupted body', () => {
    expect(checkLrc(Uint8Array.from([0x01, 0x03, 0x00, 0x00, 0x00, 0x02, 0xfb]))).toBe(false);
  });
});
