/**
 * Generates the PWA icon set from geometry — no image toolchain, no binary
 * blobs checked in that nobody can regenerate.
 *
 * The mark is a square wave: a serial signal, which is what this tool talks.
 *
 *   node scripts/generate-icons.mjs
 */

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

const BACKGROUND = [0x03, 0x69, 0xa1]; // sky-700
const STROKE = [0xff, 0xff, 0xff];

/** Design canvas the geometry below is expressed in. */
const BASE = 512;
const CORNER_RADIUS = 112;
const STROKE_WIDTH = 40;

/** Square-wave polyline, alternating low and high. */
const WAVE = [
  [88, 340], [144, 340], [144, 172], [200, 172], [200, 340], [256, 340],
  [256, 172], [312, 172], [312, 340], [368, 340], [368, 172], [424, 172],
];

/** Samples per axis; 3x3 is enough to keep the diagonal-free artwork clean. */
const SAMPLES = 3;

// --- Geometry ---------------------------------------------------------------

/** Standard rounded-box signed distance field; <= 0 means inside. */
function insideRoundedRect(x, y, size, radius) {
  if (radius <= 0) return x >= 0 && y >= 0 && x <= size && y <= size;
  const dx = Math.abs(x - size / 2) - (size / 2 - radius);
  const dy = Math.abs(y - size / 2) - (size / 2 - radius);
  const outside = Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
  const inside = Math.min(Math.max(dx, dy), 0);
  return outside + inside - radius <= 0;
}

function distanceToSegment(px, py, [ax, ay], [bx, by]) {
  const vx = bx - ax;
  const vy = by - ay;
  const lengthSq = vx * vx + vy * vy;
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / lengthSq));
  return Math.hypot(px - (ax + t * vx), py - (ay + t * vy));
}

/** Round caps and joins fall out of using distance-to-polyline directly. */
function onWave(px, py, points, halfWidth) {
  for (let i = 1; i < points.length; i++) {
    if (distanceToSegment(px, py, points[i - 1], points[i]) <= halfWidth) return true;
  }
  return false;
}

// --- Rendering --------------------------------------------------------------

function render(size, { radius, inset }) {
  // `inset` shrinks the artwork into the maskable safe zone so Android can
  // crop the icon to a circle without clipping the waveform.
  const scale = inset ?? 1;
  const offset = (BASE * (1 - scale)) / 2;
  const points = WAVE.map(([x, y]) => [x * scale + offset, y * scale + offset]);
  const halfWidth = (STROKE_WIDTH * scale) / 2;
  const scaledRadius = (radius / BASE) * size;

  const pixels = Buffer.alloc(size * size * 4);
  const step = 1 / SAMPLES;

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let inShape = 0;
      let inWave = 0;

      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const x = px + (sx + 0.5) * step;
          const y = py + (sy + 0.5) * step;
          if (!insideRoundedRect(x, y, size, scaledRadius)) continue;
          inShape++;
          // Sample the wave in design-space coordinates.
          const dx = (x / size) * BASE;
          const dy = (y / size) * BASE;
          if (onWave(dx, dy, points, halfWidth)) inWave++;
        }
      }

      const total = SAMPLES * SAMPLES;
      const alpha = Math.round((inShape / total) * 255);
      const waveMix = inShape === 0 ? 0 : inWave / inShape;

      const index = (py * size + px) * 4;
      for (let channel = 0; channel < 3; channel++) {
        pixels[index + channel] = Math.round(
          BACKGROUND[channel] * (1 - waveMix) + STROKE[channel] * waveMix,
        );
      }
      pixels[index + 3] = alpha;
    }
  }

  return pixels;
}

// --- PNG encoding -----------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let value = i;
    for (let bit = 0; bit < 8; bit++) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[i] = value;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(size, pixels) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  header[10] = 0; // deflate
  header[11] = 0; // adaptive filtering
  header[12] = 0; // no interlace

  // One filter byte (0 = none) per scanline.
  const stride = size * 4;
  const raw = Buffer.alloc(size * (stride + 1));
  for (let row = 0; row < size; row++) {
    raw[row * (stride + 1)] = 0;
    pixels.copy(raw, row * (stride + 1) + 1, row * stride, (row + 1) * stride);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// --- Entry point ------------------------------------------------------------

const TARGETS = [
  { file: 'icon-192.png', size: 192, radius: CORNER_RADIUS },
  { file: 'icon-512.png', size: 512, radius: CORNER_RADIUS },
  { file: 'icon-maskable-512.png', size: 512, radius: 0, inset: 0.8 },
  { file: 'apple-touch-icon.png', size: 180, radius: 0 },
];

mkdirSync(OUT_DIR, { recursive: true });
for (const { file, size, radius, inset } of TARGETS) {
  const png = encodePng(size, render(size, { radius, inset }));
  writeFileSync(join(OUT_DIR, file), png);
  console.log(`${file}  ${size}x${size}  ${(png.length / 1024).toFixed(1)} kB`);
}
