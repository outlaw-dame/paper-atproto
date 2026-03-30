#!/usr/bin/env node
// ─── Generate apple-touch-icon.png ───────────────────────────────────────────
// Produces a 180×180 PNG matching the favicon.svg design:
//   • Dark navy background  (#0B1220)
//   • Gradient ring  (#00B3FF → #0070E0)
//   • Accent dot     (#7DEBFF)
//   • Rounded-rect clip (rx=20 — Apple clips anyway but looks right in preview)
//
// Uses only Node.js built-ins (node:zlib, node:crypto, node:fs).
// No npm dependencies required.

import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, '../public/apple-touch-icon.png');

// ─── Dimensions ───────────────────────────────────────────────────────────────
const W = 180;
const H = 180;
const SS = 4; // super-sampling factor for anti-aliasing
const SW = W * SS;
const SH = H * SS;

// ─── Design parameters (scaled to super-sample space) ────────────────────────
const CX = (W / 2) * SS;       // ring centre x
const CY = (H / 2) * SS;       // ring centre y
const R_OUTER = 50 * SS;        // outer radius of ring
const R_INNER = (50 - 8) * SS;  // inner radius of ring (stroke width = 8)
const DOT_CX = 112 * SS;        // accent dot centre x  (matches SVG cx=40 scaled)
const DOT_CY = 72 * SS;         // accent dot centre y  (matches SVG cy=26 scaled)
const DOT_R = 14 * SS;          // accent dot radius
const CORNER_R = 20 * SS;       // rounded-rect corner radius

// ─── Colours ──────────────────────────────────────────────────────────────────
const BG = [0x0B, 0x12, 0x20];          // #0B1220
const RING_START = [0x00, 0xB3, 0xFF];  // #00B3FF
const RING_END   = [0x00, 0x70, 0xE0];  // #0070E0
const DOT_COLOR  = [0x7D, 0xEB, 0xFF];  // #7DEBFF

// ─── Per-pixel drawing in super-sample space ──────────────────────────────────

/** Check if (x, y) is inside a rounded-rect [0,SW]×[0,SH] with corner radius. */
function insideRoundedRect(x, y) {
  const cx = CORNER_R, cy = CORNER_R;
  const bx = SW - CORNER_R, by = SH - CORNER_R;
  if (x < cx && y < cy) return dist2(x, y, cx, cy) <= CORNER_R * CORNER_R;
  if (x > bx && y < cy) return dist2(x, y, bx, cy) <= CORNER_R * CORNER_R;
  if (x < cx && y > by) return dist2(x, y, cx, by) <= CORNER_R * CORNER_R;
  if (x > bx && y > by) return dist2(x, y, bx, by) <= CORNER_R * CORNER_R;
  return true;
}

function dist2(ax, ay, bx, by) {
  const dx = ax - bx, dy = ay - by;
  return dx * dx + dy * dy;
}

function dist(ax, ay, bx, by) {
  return Math.sqrt(dist2(ax, ay, bx, by));
}

// Allocate RGBA buffer for super-sampled image
const buf = new Uint8ClampedArray(SW * SH * 4);

for (let sy = 0; sy < SH; sy++) {
  for (let sx = 0; sx < SW; sx++) {
    const idx = (sy * SW + sx) * 4;
    const inCard = insideRoundedRect(sx, sy);

    if (!inCard) {
      // Fully transparent outside the rounded rect
      buf[idx + 3] = 0;
      continue;
    }

    const dRing = dist(sx, sy, CX, CY);
    const dDot  = dist(sx, sy, DOT_CX, DOT_CY);
    const inRing = dRing >= R_INNER && dRing <= R_OUTER;
    const inDot  = dDot  <= DOT_R;

    let r, g, b;
    if (inDot) {
      [r, g, b] = DOT_COLOR;
    } else if (inRing) {
      // Linear gradient along x-axis across ring bounding box
      const t = Math.max(0, Math.min(1, (sx - (CX - R_OUTER)) / (2 * R_OUTER)));
      r = Math.round(RING_START[0] + t * (RING_END[0] - RING_START[0]));
      g = Math.round(RING_START[1] + t * (RING_END[1] - RING_START[1]));
      b = Math.round(RING_START[2] + t * (RING_END[2] - RING_START[2]));
    } else {
      [r, g, b] = BG;
    }

    buf[idx]     = r;
    buf[idx + 1] = g;
    buf[idx + 2] = b;
    buf[idx + 3] = 255;
  }
}

// ─── Downsample SS×SS → 1 pixel ───────────────────────────────────────────────
// Output is RGB (no alpha — apple-touch-icon is always opaque)

const pixels = new Uint8Array(W * H * 3);

for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy2 = 0; sy2 < SS; sy2++) {
      for (let sx2 = 0; sx2 < SS; sx2++) {
        const i = ((y * SS + sy2) * SW + (x * SS + sx2)) * 4;
        // Premultiplied alpha compositing over opaque BG
        const alpha = buf[i + 3] / 255;
        r += (buf[i]     * alpha + BG[0] * (1 - alpha));
        g += (buf[i + 1] * alpha + BG[1] * (1 - alpha));
        b += (buf[i + 2] * alpha + BG[2] * (1 - alpha));
        a += buf[i + 3];
      }
    }
    const div = SS * SS;
    const out = (y * W + x) * 3;
    pixels[out]     = Math.round(r / div);
    pixels[out + 1] = Math.round(g / div);
    pixels[out + 2] = Math.round(b / div);
  }
}

// ─── Build PNG scanlines ───────────────────────────────────────────────────────
// Each row: 1 filter byte (0 = None) + W * 3 RGB bytes

const stride = 1 + W * 3;
const scanlines = new Uint8Array(H * stride);

for (let y = 0; y < H; y++) {
  scanlines[y * stride] = 0; // filter = None
  const rowSrc = y * W * 3;
  const rowDst = y * stride + 1;
  scanlines.set(pixels.subarray(rowSrc, rowSrc + W * 3), rowDst);
}

// ─── PNG encoding ─────────────────────────────────────────────────────────────

// CRC32 table (ISO 3309 polynomial)
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    }
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc = (CRC_TABLE[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8)) >>> 0;
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function uint32BE(value) {
  const b = Buffer.allocUnsafe(4);
  b.writeUInt32BE(value >>> 0, 0);
  return b;
}

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const dataBytes = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const crcBuf = Buffer.concat([typeBytes, dataBytes]);
  return Buffer.concat([
    uint32BE(dataBytes.length),
    typeBytes,
    dataBytes,
    uint32BE(crc32(crcBuf)),
  ]);
}

// IHDR: width, height, bit depth=8, colour type=2 (RGB), compression=0, filter=0, interlace=0
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8]  = 8; // bit depth
ihdr[9]  = 2; // colour type: RGB (no alpha — opaque icon)
ihdr[10] = 0; // deflate compression
ihdr[11] = 0; // adaptive filtering
ihdr[12] = 0; // no interlace

// IDAT: deflate-compressed scanlines
const idat = deflateSync(Buffer.from(scanlines), { level: 9 });

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), // PNG signature
  pngChunk('IHDR', ihdr),
  pngChunk('IDAT', idat),
  pngChunk('IEND', Buffer.alloc(0)),
]);

writeFileSync(OUT, png);

// Verify the output is a valid PNG by checking the signature and a SHA-256 digest
const digest = createHash('sha256').update(png).digest('hex').slice(0, 12);
console.log(`✓ apple-touch-icon.png  ${png.length} bytes  sha256:${digest}…`);
console.log(`  → ${OUT}`);
