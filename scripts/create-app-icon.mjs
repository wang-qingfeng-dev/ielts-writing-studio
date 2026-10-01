import { writeFile } from 'node:fs/promises';

// 生成 Windows 标题栏使用的 32×32 ICO。图形与 public/favicon.svg 保持一致，避免使用 Electron 默认图标。
const size = 32;
const pixels = Buffer.alloc(size * size * 4);
const inside = (x, y) => {
  const r = 7;
  const cx = x < r ? r : x >= size - r ? size - r - 1 : x;
  const cy = y < r ? r : y >= size - r ? size - r - 1 : y;
  return (x - cx) ** 2 + (y - cy) ** 2 <= r ** 2;
};
const put = (x, y, color) => {
  if (x < 0 || y < 0 || x >= size || y >= size) return;
  const offset = (y * size + x) * 4;
  pixels[offset] = color[2]; pixels[offset + 1] = color[1]; pixels[offset + 2] = color[0]; pixels[offset + 3] = color[3] ?? 255;
};
const paint = (x, y, color) => { if (inside(x, y)) put(x, y, color); };
const pointIn = (x, y, polygon) => {
  let hit = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i], [xj, yj] = polygon[j];
    if (((yi > y) !== (yj > y)) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
};
const fillPolygon = (polygon, color) => { for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (pointIn(x + .5, y + .5, polygon)) paint(x, y, color); };

for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) paint(x, y, [24 + Math.round(y / 8), 86 + Math.round(y / 5), 61 + Math.round(y / 7), 255]);
fillPolygon([[7, 10], [15.4, 12.4], [15.4, 26], [7, 23.4]], [245, 251, 246, 255]);
fillPolygon([[16.6, 12.4], [25, 10], [25, 23.4], [16.6, 26]], [216, 235, 223, 235]);
for (let y = 16; y <= 21; y += 3) for (let x = 9; x < 14; x++) paint(x, y, [157, 196, 171, 255]);
for (let y = 16; y <= 21; y += 3) for (let x = 19; x < 24; x++) paint(x, y, [137, 180, 157, 240]);
for (let y = 12; y < 27; y++) paint(16, y, [185, 213, 155, 255]);
for (let d = -2; d <= 2; d++) { paint(27 + d, 7, [233, 207, 131, 255]); paint(27, 7 + d, [233, 207, 131, 255]); }

const header = Buffer.alloc(6); header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(1, 4);
const entry = Buffer.alloc(16); entry[0] = size; entry[1] = size; entry.writeUInt16LE(1, 4); entry.writeUInt16LE(32, 6);
const dibSize = 40, xorSize = pixels.length, mask = Buffer.alloc(size * 4 * size / 8), imageSize = dibSize + xorSize + mask.length;
entry.writeUInt32LE(imageSize, 8); entry.writeUInt32LE(22, 12);
const dib = Buffer.alloc(dibSize); dib.writeUInt32LE(dibSize, 0); dib.writeInt32LE(size, 4); dib.writeInt32LE(size * 2, 8); dib.writeUInt16LE(1, 12); dib.writeUInt16LE(32, 14); dib.writeUInt32LE(xorSize, 20);
const bottomUp = Buffer.alloc(pixels.length);
for (let y = 0; y < size; y++) pixels.copy(bottomUp, (size - 1 - y) * size * 4, y * size * 4, (y + 1) * size * 4);
await writeFile(new URL('../public/app-icon.ico', import.meta.url), Buffer.concat([header, entry, dib, bottomUp, mask]));
