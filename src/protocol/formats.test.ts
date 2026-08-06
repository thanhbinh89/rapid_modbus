import { describe, expect, it } from 'vitest';
import type { FormatId } from './formats';
import { FORMATS, WORD_ORDERS, byteOrderPermutation, decode, encode } from './formats';

describe('the format catalogue', () => {
  it('has exactly 29 formats', () => {
    expect(FORMATS).toHaveLength(29);
  });

  it('has unique ids', () => {
    expect(new Set(FORMATS.map((f) => f.id)).size).toBe(FORMATS.length);
  });

  it('covers every wide type in all four word orders', () => {
    for (const kind of ['int32', 'uint32', 'int64', 'uint64', 'float32', 'float64']) {
      for (const order of WORD_ORDERS) {
        expect(FORMATS.some((f) => f.id === `${kind}_${order}`)).toBe(true);
      }
    }
  });
});

describe('byteOrderPermutation', () => {
  it('maps the four orders over 4 bytes', () => {
    expect(byteOrderPermutation('ABCD', 4)).toEqual([0, 1, 2, 3]);
    expect(byteOrderPermutation('DCBA', 4)).toEqual([3, 2, 1, 0]);
    expect(byteOrderPermutation('BADC', 4)).toEqual([1, 0, 3, 2]);
    expect(byteOrderPermutation('CDAB', 4)).toEqual([2, 3, 0, 1]);
  });

  it('extends consistently to 8 bytes', () => {
    expect(byteOrderPermutation('ABCD', 8)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(byteOrderPermutation('DCBA', 8)).toEqual([7, 6, 5, 4, 3, 2, 1, 0]);
    expect(byteOrderPermutation('BADC', 8)).toEqual([1, 0, 3, 2, 5, 4, 7, 6]);
    expect(byteOrderPermutation('CDAB', 8)).toEqual([6, 7, 4, 5, 2, 3, 0, 1]);
  });

  it('is a true permutation for every order and width', () => {
    for (const order of WORD_ORDERS) {
      for (const width of [2, 4, 8]) {
        const perm = byteOrderPermutation(order, width);
        expect([...perm].sort((a, b) => a - b)).toEqual(
          Array.from({ length: width }, (_, i) => i),
        );
      }
    }
  });
});

describe('16-bit formats', () => {
  it('decodes signed values', () => {
    expect(decode([0xfffe], 'int16').numeric).toBe(-2);
    expect(decode([0x7fff], 'int16').numeric).toBe(32767);
    expect(decode([0x8000], 'int16').numeric).toBe(-32768);
  });

  it('decodes unsigned values', () => {
    expect(decode([0xfffe], 'uint16').numeric).toBe(65534);
  });

  it('decodes hex with leading zeros', () => {
    expect(decode([0x00ff], 'hex16').text).toBe('00FF');
  });

  it('decodes ASCII, replacing unprintable bytes', () => {
    expect(decode([0x4142], 'ascii16').text).toBe('AB');
    expect(decode([0x0041], 'ascii16').text).toBe('.A');
  });

  it('decodes binary padded to 16 digits', () => {
    expect(decode([0x000f], 'binary16').text).toBe('0000000000001111');
  });
});

describe('32-bit word order', () => {
  // 0x12345678 laid out as A=12 B=34 C=56 D=78
  const cases: Array<[FormatId, number[]]> = [
    ['int32_ABCD', [0x1234, 0x5678]],
    ['int32_BADC', [0x3412, 0x7856]],
    ['int32_CDAB', [0x5678, 0x1234]],
    ['int32_DCBA', [0x7856, 0x3412]],
  ];

  it.each(cases)('%s decodes to 305419896', (id, registers) => {
    expect(decode(registers, id).numeric).toBe(0x12345678);
  });

  it('decodes negative Int32 values', () => {
    expect(decode([0xffff, 0xfffe], 'int32_ABCD').numeric).toBe(-2);
  });

  it('decodes UInt32 without sign extension', () => {
    expect(decode([0xffff, 0xfffe], 'uint32_ABCD').numeric).toBe(4294967294);
  });
});

describe('Float32 word order', () => {
  // 25.0 == 0x41C80000, the classic "why is my float garbage" test value
  const cases: Array<[FormatId, number[]]> = [
    ['float32_ABCD', [0x41c8, 0x0000]],
    ['float32_BADC', [0xc841, 0x0000]],
    ['float32_CDAB', [0x0000, 0x41c8]],
    ['float32_DCBA', [0x0000, 0xc841]],
  ];

  it.each(cases)('%s decodes to 25', (id, registers) => {
    expect(decode(registers, id).numeric).toBe(25);
    expect(decode(registers, id).text).toBe('25');
  });

  it('shows the wrong value when the order is wrong', () => {
    // Same bytes read as CDAB instead of ABCD -> nonsense, which is exactly
    // what an engineer sees in the field before flipping the order.
    expect(decode([0x41c8, 0x0000], 'float32_CDAB').numeric).not.toBe(25);
  });
});

describe('64-bit word order', () => {
  const value = 0x0123456789abcdefn;
  const cases: Array<[FormatId, number[]]> = [
    ['int64_ABCD', [0x0123, 0x4567, 0x89ab, 0xcdef]],
    ['int64_BADC', [0x2301, 0x6745, 0xab89, 0xefcd]],
    ['int64_CDAB', [0xcdef, 0x89ab, 0x4567, 0x0123]],
    ['int64_DCBA', [0xefcd, 0xab89, 0x6745, 0x2301]],
  ];

  it.each(cases)('%s decodes exactly via BigInt', (id, registers) => {
    expect(decode(registers, id).big).toBe(value);
  });

  it('decodes Float64', () => {
    // 1.0 == 0x3FF0000000000000
    expect(decode([0x3ff0, 0x0000, 0x0000, 0x0000], 'float64_ABCD').numeric).toBe(1);
  });

  it('keeps UInt64 exact beyond Number.MAX_SAFE_INTEGER', () => {
    const decoded = decode([0xffff, 0xffff, 0xffff, 0xffff], 'uint64_ABCD');
    expect(decoded.big).toBe(18446744073709551615n);
    expect(decoded.text).toBe('18446744073709551615');
  });
});

describe('decode guards', () => {
  it('throws when there are not enough registers', () => {
    expect(() => decode([0x0001], 'int32_ABCD')).toThrow(RangeError);
    expect(() => decode([0x0001, 0x0002], 'int64_ABCD')).toThrow(RangeError);
  });

  it('throws on an unknown format id', () => {
    expect(() => decode([0], 'nope' as FormatId)).toThrow(RangeError);
  });
});

describe('encode', () => {
  it('round-trips every wide format', () => {
    const samples: Record<string, string> = {
      int32: '-305419896',
      uint32: '3989547399',
      int64: '-81985529216486895',
      uint64: '18446744073709551615',
      float32: '25',
      float64: '-1234.5',
    };
    for (const [kind, text] of Object.entries(samples)) {
      for (const order of WORD_ORDERS) {
        const id = `${kind}_${order}` as FormatId;
        expect(decode(encode(text, id), id).text, id).toBe(text);
      }
    }
  });

  it('round-trips 16-bit formats', () => {
    expect(decode(encode('-2', 'int16'), 'int16').text).toBe('-2');
    expect(decode(encode('65534', 'uint16'), 'uint16').text).toBe('65534');
    expect(decode(encode('00FF', 'hex16'), 'hex16').text).toBe('00FF');
    expect(decode(encode('1111', 'binary16'), 'binary16').text).toBe('0000000000001111');
    expect(decode(encode('AB', 'ascii16'), 'ascii16').text).toBe('AB');
  });

  it('accepts hex with an 0x prefix', () => {
    expect(encode('0x00FF', 'hex16')).toEqual([0xff]);
  });

  it('produces the byte layout the word order implies', () => {
    expect(encode('25', 'float32_ABCD')).toEqual([0x41c8, 0x0000]);
    expect(encode('25', 'float32_CDAB')).toEqual([0x0000, 0x41c8]);
  });

  it('rejects out-of-range 16-bit input', () => {
    expect(() => encode('32768', 'int16')).toThrow(RangeError);
    expect(() => encode('-1', 'uint16')).toThrow(RangeError);
    expect(() => encode('65536', 'uint16')).toThrow(RangeError);
  });

  it('rejects malformed input', () => {
    expect(() => encode('abc', 'int16')).toThrow(RangeError);
    expect(() => encode('12', 'binary16')).toThrow(RangeError);
    expect(() => encode('GG', 'hex16')).toThrow(RangeError);
    expect(() => encode('not a number', 'float32_ABCD')).toThrow(RangeError);
    expect(() => encode('-1', 'uint64_ABCD')).toThrow(RangeError);
  });
});
