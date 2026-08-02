// Regenerate icon-180.png from the same night-sky palette as icon.svg.
// Uses only Node built-ins so the repository keeps its no-dependencies rule.
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const W = 180;
const H = 180;
const pixels = Buffer.alloc(W * H * 4);

function blend(index, color, alpha = 1) {
  const a = Math.max(0, Math.min(1, alpha));
  pixels[index] = Math.round(pixels[index] * (1 - a) + color[0] * a);
  pixels[index + 1] = Math.round(pixels[index + 1] * (1 - a) + color[1] * a);
  pixels[index + 2] = Math.round(pixels[index + 2] * (1 - a) + color[2] * a);
  pixels[index + 3] = 255;
}

const star = [
  [90, 18], [106, 56], [148, 51], [122, 84], [148, 117], [106, 112],
  [90, 151], [74, 112], [32, 117], [58, 84], [32, 51], [74, 56],
];

function insidePolygon(x, y, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function lineDistance(x, y, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(x - (a[0] + t * dx), y - (a[1] + t * dy));
}

for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    const glow = Math.max(0, 1 - Math.hypot(x - 90, y - 45) / 150);
    pixels[i] = 6 + Math.round(13 * glow);
    pixels[i + 1] = 17 + Math.round(34 * glow);
    pixels[i + 2] = 39 + Math.round(61 * glow);
    pixels[i + 3] = 255;

    if (insidePolygon(x, y, star)) blend(i, [20, 48, 84], .9);
    const edge = Math.min(...star.map((point, n) => lineDistance(x, y, point, star[(n + 1) % star.length])));
    if (edge < 1.6) blend(i, [121, 217, 208], .55 * (1 - edge / 1.6));
  }
}

function circle(cx, cy, radius, color) {
  for (let y = Math.floor(cy - radius - 6); y <= Math.ceil(cy + radius + 6); y++) {
    for (let x = Math.floor(cx - radius - 6); x <= Math.ceil(cx + radius + 6); x++) {
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const i = (y * W + x) * 4;
      const d = Math.hypot(x - cx, y - cy);
      if (d < radius + 5) blend(i, color, Math.max(0, .14 * (1 - (d - radius) / 5)));
      if (d <= radius) {
        const shade = .58 + .42 * Math.max(0, 1 - Math.hypot(x - (cx - 3), y - (cy - 3)) / (radius * 1.7));
        blend(i, color.map((channel) => channel * shade), 1);
      }
      if (Math.hypot(x - (cx - 3), y - (cy - 3)) < 1.8) blend(i, [255, 255, 255], .9);
    }
  }
}

[[90, 41], [80, 58], [100, 58], [70, 75], [90, 75], [110, 75]].forEach(([x, y]) => circle(x, y, 8, [95, 243, 195]));
circle(90, 104, 7, [255, 232, 163]);

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const name = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8;
ihdr[9] = 6;
const scanlines = Buffer.alloc((W * 4 + 1) * H);
for (let y = 0; y < H; y++) pixels.copy(scanlines, y * (W * 4 + 1) + 1, y * W * 4, (y + 1) * W * 4);
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', ihdr), chunk('IDAT', deflateSync(scanlines, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
]);
writeFileSync(new URL('../icon-180.png', import.meta.url), png);

