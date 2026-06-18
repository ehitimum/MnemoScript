/**
 * Procedural parchment / aged-paper background. Rendered once per (size+colour)
 * to a low-res canvas (the Konva stage upscales it smoothly) and cached, so it
 * costs nothing on re-render. Gives the map that warm hand-drawn base instead of
 * a flat fill.
 */
import { createNoise2D } from 'simplex-noise';
import { mulberry32 } from './heightmap';

const cache = new Map<string, HTMLCanvasElement>();

function hexToRgb(hex: string): [number, number, number] {
  const m = hex.replace('#', '');
  const n = parseInt(m.length === 3 ? m.replace(/(.)/g, '$1$1') : m, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const clamp = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);

export function makeParchment(w: number, h: number, color: string): HTMLCanvasElement {
  const key = `${Math.round(w)}x${Math.round(h)}|${color}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const cols = 360;
  const rows = Math.max(120, Math.round((cols * h) / w));
  const cv = document.createElement('canvas');
  cv.width = cols; cv.height = rows;
  const ctx = cv.getContext('2d')!;
  const [br, bg, bb] = hexToRgb(color);

  const grain = createNoise2D(mulberry32(7));
  const stain = createNoise2D(mulberry32(99));
  const img = ctx.createImageData(cols, rows);
  const px = img.data;

  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      // fine fibre grain
      const g = grain(i * 0.9, j * 0.9) * 6 + grain(i * 0.18, j * 0.18) * 10;
      // soft blotchy stains
      const s = Math.max(0, stain(i * 0.012, j * 0.012)) * 14;
      // edge vignette (darker toward the borders)
      const dx = (i / cols) * 2 - 1;
      const dy = (j / rows) * 2 - 1;
      const vig = Math.max(0, (Math.sqrt(dx * dx + dy * dy) - 0.6)) * 46;
      const k = (j * cols + i) * 4;
      px[k] = clamp(br + g - s - vig);
      px[k + 1] = clamp(bg + g - s - vig);
      px[k + 2] = clamp(bb + g - s * 1.2 - vig);
      px[k + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  cache.set(key, cv);
  return cv;
}
