// Renders assets/extension-icon.png (512x512) without any image library:
// a charcoal tile with seven ivory keys, five black keys and one amber "pressed" key.
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SIZE = 512;
const px = new Uint8Array(SIZE * SIZE * 4);

function hex(color) {
  return [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));
}

function fillRoundedRect(x0, y0, w, h, radius, color, alpha = 1) {
  const [r, g, b] = hex(color);
  for (let y = Math.max(0, Math.floor(y0)); y < Math.min(SIZE, Math.ceil(y0 + h)); y++) {
    for (let x = Math.max(0, Math.floor(x0)); x < Math.min(SIZE, Math.ceil(x0 + w)); x++) {
      const cx = x + 0.5;
      const cy = y + 0.5;
      const dx = Math.max(x0 + radius - cx, 0, cx - (x0 + w - radius));
      const dy = Math.max(y0 + radius - cy, 0, cy - (y0 + h - radius));
      const dist = Math.hypot(dx, dy);
      const coverage = Math.min(1, Math.max(0, radius - dist + 0.5)) * alpha;
      if (coverage <= 0) continue;
      const i = (y * SIZE + x) * 4;
      px[i] = px[i] * (1 - coverage) + r * coverage;
      px[i + 1] = px[i + 1] * (1 - coverage) + g * coverage;
      px[i + 2] = px[i + 2] * (1 - coverage) + b * coverage;
      px[i + 3] = 255;
    }
  }
}

fillRoundedRect(0, 0, SIZE, SIZE, 0, "#1C1C21");

const whiteCount = 7;
const margin = 56;
const gap = 7;
const keyWidth = (SIZE - margin * 2 - gap * (whiteCount - 1)) / whiteCount;
const top = 88;
const bottom = SIZE - 72;
const pressedIndex = 2;

for (let i = 0; i < whiteCount; i++) {
  const x = margin + i * (keyWidth + gap);
  const color = i === pressedIndex ? "#FFB547" : "#F4EFE5";
  fillRoundedRect(x, top, keyWidth, bottom - top, 18, i === pressedIndex ? "#E8961E" : "#D9D1C2");
  fillRoundedRect(x, top, keyWidth, bottom - top - 10, 18, color);
}

const blackWidth = keyWidth * 0.62;
const blackHeight = (bottom - top) * 0.6;
for (const i of [0, 1, 3, 4, 5]) {
  const x = margin + (i + 1) * (keyWidth + gap) - gap / 2 - blackWidth / 2;
  fillRoundedRect(x, top - 6, blackWidth, blackHeight, 14, "#101013");
  fillRoundedRect(x, top - 6, blackWidth, blackHeight - 10, 14, "#26262C");
}

function crc32(buffer) {
  let crc = ~0;
  for (const byte of buffer) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typed = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([length, typed, crc]);
}

const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE);
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 4 + 1)] = 0;
  Buffer.from(px.buffer, y * SIZE * 4, SIZE * 4).copy(raw, y * (SIZE * 4 + 1) + 1);
}
const header = Buffer.alloc(13);
header.writeUInt32BE(SIZE, 0);
header.writeUInt32BE(SIZE, 4);
header[8] = 8;
header[9] = 6;
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", header),
  chunk("IDAT", deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "assets", "extension-icon.png");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, png);
console.log(`wrote ${out} (${png.length} bytes)`);
