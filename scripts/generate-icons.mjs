/**
 * Rasterise the LumaMark brand mark (gradient tile + bookmark + spark) into the
 * PNG sizes browsers require. Dependency-free: shapes are sampled analytically
 * and encoded with node:zlib.
 *
 *   node scripts/generate-icons.mjs
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(root, 'apps/extension/src/assets/icons');

// Geometry on a 32×32 design grid (matches the inline SVG logo).
const insideRoundedRect = (x, y, w, h, r) => {
  const cx = Math.min(Math.max(x, r), w - r);
  const cy = Math.min(Math.max(y, r), h - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r && x >= 0 && y >= 0 && x <= w && y <= h;
};
const insidePolygon = (x, y, points) => {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const [xi, yi] = points[i]; const [xj, yj] = points[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
const bookmark = [[9.5, 10], [10, 9], [11, 8.5], [21, 8.5], [22, 9], [22.5, 10], [22.5, 24], [16, 20.2], [9.5, 24]];
const spark = [[19.5, 4.5], [20.4, 6.6], [22.5, 7.5], [20.4, 8.4], [19.5, 10.5], [18.6, 8.4], [16.5, 7.5], [18.6, 6.6]];
const lerp = (a, b, t) => a + (b - a) * t;
const from = [124, 108, 255]; const to = [236, 95, 168];

function render(size) {
  const samples = 4;
  const pixels = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      let r = 0; let g = 0; let b = 0; let a = 0;
      for (let sy = 0; sy < samples; sy += 1) {
        for (let sx = 0; sx < samples; sx += 1) {
          const x = ((px + (sx + 0.5) / samples) / size) * 32;
          const y = ((py + (sy + 0.5) / samples) / size) * 32;
          if (!insideRoundedRect(x, y, 32, 32, 9)) continue;
          const t = Math.min(1, Math.max(0, (x + y) / 64));
          let color = [lerp(from[0], to[0], t), lerp(from[1], to[1], t), lerp(from[2], to[2], t)];
          if (insidePolygon(x, y, bookmark)) color = [255 * 0.95 + color[0] * 0.05, 255 * 0.95 + color[1] * 0.05, 255 * 0.95 + color[2] * 0.05];
          if (insidePolygon(x, y, spark)) color = [255, 255, 255];
          r += color[0]; g += color[1]; b += color[2]; a += 1;
        }
      }
      const total = samples * samples;
      const offset = (py * size + px) * 4;
      pixels[offset] = a ? Math.round(r / a) : 0;
      pixels[offset + 1] = a ? Math.round(g / a) : 0;
      pixels[offset + 2] = a ? Math.round(b / a) : 0;
      pixels[offset + 3] = Math.round((a / total) * 255);
    }
  }
  return pixels;
}

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (buffer) => { let c = 0xffffffff; for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}
function png(size, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6; header[10] = 0; header[11] = 0; header[12] = 0;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y += 1) { raw[y * (size * 4 + 1)] = 0; rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4); }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

await mkdir(outDir, { recursive: true });
for (const size of [16, 32, 48, 128]) {
  await writeFile(resolve(outDir, `icon-${size}.png`), png(size, render(size)));
}
console.log(`Icons written to ${outDir}`);
