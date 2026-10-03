// Generates the small built-in icon set for user-drawn points: white 32x32 shapes (tinted by the
// feature color). Writes to public/builtin-icons (shown on the globe) and src-tauri/assets/builtin-icons
// (bundled into exported KMZ files). Run with: node --no-warnings test-data/make-builtin-icons.ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { png } from './lib.ts';

const SIZE = 32;
const C = (SIZE - 1) / 2;

type Shape = (x: number, y: number) => boolean;

const shapes: Record<string, Shape> = {
  circle: (x, y) => Math.hypot(x - C, y - C) <= 13,
  square: (x, y) => Math.abs(x - C) <= 11 && Math.abs(y - C) <= 11,
  diamond: (x, y) => Math.abs(x - C) + Math.abs(y - C) <= 14,
  triangle: (x, y) => y >= 4 && y <= 27 && Math.abs(x - C) <= ((y - 4) / 23) * 13,
  star: (x, y) => {
    // Five-point star: inside if within the star-shaped radius at this angle.
    const a = Math.atan2(y - C, x - C) + Math.PI / 2;
    const k = ((a % ((2 * Math.PI) / 5)) + (2 * Math.PI) / 5) % ((2 * Math.PI) / 5);
    const t = Math.abs(k - Math.PI / 5) / (Math.PI / 5); // 0 at a tip, 1 at a notch
    return Math.hypot(x - C, y - C) <= 14 - 8 * t;
  },
};

const outDirs = [
  fileURLToPath(new URL('../public/builtin-icons/', import.meta.url)),
  fileURLToPath(new URL('../src-tauri/assets/builtin-icons/', import.meta.url)),
];

for (const dir of outDirs) mkdirSync(dir, { recursive: true });
for (const [name, inside] of Object.entries(shapes)) {
  const data = png(SIZE, SIZE, (x, y) => {
    if (!inside(x, y)) return [0, 0, 0, 0];
    // A darker rim helps the icon read on light and dark basemaps.
    const edge = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => !inside(x + dx, y + dy));
    return edge ? [90, 90, 90, 255] : [255, 255, 255, 255];
  });
  for (const dir of outDirs) writeFileSync(dir + name + '.png', data);
}
console.log('wrote', Object.keys(shapes).join(', '));
