/**
 * Paintable terrain heightmap — the heart of the Inkarnate-style ground engine.
 *
 * A medium-res Float32 grid (0..1 elevation) that BOTH the procedural generator
 * fills AND the landmass brush edits. `render()` turns it into a styled terrain
 * raster: sea depth gradient, a soft **coastline glow** (the classic fantasy-map
 * halo), elevation-banded biome colours and a subtle mottled land texture.
 *
 * Persistence: the grid is encoded to a small grayscale PNG (`toDataURL`) stored
 * in the document; `fromDataURL` rebuilds it. Generated terrain can instead store
 * just seed+params and re-derive via `fromNoise`.
 */
import { createNoise2D } from 'simplex-noise';
import type { BiomePreset } from './mapTypes';

export const TERRAIN_COLS = 320;

/* ── seeded RNG (shared with the generator) ─────────────────────────────── */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function randomSeed(): number {
  return Math.floor(Math.random() * 0xffffffff);
}

/* ── biome palettes (sea → peak) ────────────────────────────────────────── */
interface Palette {
  deep: string; sea: string; shallow: string; glow: string; sand: string;
  land: string[]; // low → high land bands
}
const PALETTES: Record<BiomePreset, Palette> = {
  temperate: {
    deep: '#33617f', sea: '#3f7191', shallow: '#6aa6bf', glow: '#dfe9c9', sand: '#dac999',
    land: ['#a7c06f', '#90b45d', '#79a44f', '#669244', '#7f8c52', '#9a9079', '#c6c0b2', '#f1efe8'],
  },
  arid: {
    deep: '#2f566b', sea: '#3d6c80', shallow: '#69a0ac', glow: '#efe2bd', sand: '#e7d6a4',
    land: ['#dcc488', '#d0b06a', '#c39c52', '#b48440', '#9d7138', '#8b8170', '#bdb7a7', '#f0ece1'],
  },
  arctic: {
    deep: '#3a5a70', sea: '#4d758c', shallow: '#83b0c4', glow: '#eef4f6', sand: '#cfd6d2',
    land: ['#cdd7d2', '#bbcac6', '#a9bcbb', '#a3b4b8', '#b7c4ca', '#d2dade', '#e9eef1', '#ffffff'],
  },
  volcanic: {
    deep: '#241f2b', sea: '#352a39', glow: '#caa07a', shallow: '#574350', sand: '#5b4b45',
    land: ['#6c5952', '#7c5c4c', '#8c5942', '#9c5136', '#7f3c2c', '#5e2e24', '#3e211c', '#241715'],
  },
  verdant: {
    deep: '#22685f', sea: '#2f897b', shallow: '#5bb39c', glow: '#e7e7c2', sand: '#e3d6a0',
    land: ['#8cc26e', '#73b45a', '#5ca34c', '#479240', '#3a823b', '#5e7d4a', '#9aa182', '#e8ead8'],
  },
};

function clamp(v: number, lo: number, hi: number): number { return v < lo ? lo : v > hi ? hi : v; }
function smooth(t: number): number { return t * t * (3 - 2 * t); }
function hexToRgb(hex: string): [number, number, number] {
  const m = hex.replace('#', '');
  const n = parseInt(m.length === 3 ? m.replace(/(.)/g, '$1$1') : m, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function lerp(a: number, b: number, t: number): number { return a + (b - a) * t; }
function lerpRgb(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

export interface GenLikeParams {
  shape: 'island' | 'continent' | 'archipelago';
  seed: number;
  landAmount: number;
  roughness: number;
  biomePreset: BiomePreset;
}

export class HeightMap {
  cols: number;
  rows: number;
  data: Float32Array;
  tex: Float32Array;     // static mottle noise (-1..1) for land texture
  seaLevel: number;
  preset: BiomePreset;

  constructor(cols: number, rows: number, seaLevel: number, preset: BiomePreset, data?: Float32Array) {
    this.cols = cols;
    this.rows = rows;
    this.seaLevel = seaLevel;
    this.preset = preset;
    this.data = data ?? new Float32Array(cols * rows);
    this.tex = makeTexture(cols, rows);
  }

  static blank(w: number, h: number, preset: BiomePreset, seaLevel = 0.4): HeightMap {
    const cols = TERRAIN_COLS;
    const rows = Math.max(60, Math.round((cols * h) / w));
    return new HeightMap(cols, rows, seaLevel, preset);
  }

  /** Procedural fbm landmass shaped by a radial falloff. */
  static fromNoise(params: GenLikeParams, w: number, h: number): HeightMap {
    const cols = TERRAIN_COLS;
    const rows = Math.max(60, Math.round((cols * h) / w));
    const rng = mulberry32(params.seed || 1);
    const noise = createNoise2D(rng);
    const octaves = clamp(Math.round(params.roughness), 1, 6);
    const data = new Float32Array(cols * rows);

    let min = Infinity; let max = -Infinity;
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const nx = (i / cols) * 2 - 1;
        const ny = (j / rows) * 2 - 1;
        let amp = 1; let freq = 1.7; let val = 0; let norm = 0;
        for (let o = 0; o < octaves; o++) {
          val += amp * noise((nx * freq + 4) * 1.1, (ny * freq + 4) * 1.1);
          norm += amp; amp *= 0.5; freq *= 2;
        }
        let e = (val / norm) * 0.5 + 0.5;
        e -= radialFalloff(nx, ny, params.shape);
        if (params.shape === 'archipelago') e -= Math.max(0, noise(nx * 3.3, ny * 3.3)) * 0.25;
        data[j * cols + i] = e;
        if (e < min) min = e; if (e > max) max = e;
      }
    }
    const span = max - min || 1;
    for (let k = 0; k < data.length; k++) data[k] = (data[k] - min) / span;

    const seaLevel = 1 - clamp(params.landAmount, 0.1, 0.92);
    return new HeightMap(cols, rows, seaLevel, params.biomePreset, data);
  }

  /** Sample elevation at canvas-space (x,y). */
  at(x: number, y: number, w: number, h: number): number {
    const i = clamp(Math.floor((x / w) * this.cols), 0, this.cols - 1);
    const j = clamp(Math.floor((y / h) * this.rows), 0, this.rows - 1);
    return this.data[j * this.cols + i];
  }
  isLand(x: number, y: number, w: number, h: number): boolean {
    return this.at(x, y, w, h) >= this.seaLevel;
  }

  /** Raise (land) or lower (sea) elevation under a soft circular brush. */
  paint(cx: number, cy: number, radius: number, strength: number, raise: boolean, w: number, h: number): void {
    const gx = (cx / w) * this.cols;
    const gy = (cy / h) * this.rows;
    const gr = Math.max(1, (radius / w) * this.cols);
    const i0 = Math.max(0, Math.floor(gx - gr));
    const i1 = Math.min(this.cols - 1, Math.ceil(gx + gr));
    const j0 = Math.max(0, Math.floor(gy - gr));
    const j1 = Math.min(this.rows - 1, Math.ceil(gy + gr));
    const dir = raise ? 1 : -1;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const d = Math.hypot(i - gx, j - gy);
        if (d > gr) continue;
        const fall = smooth(1 - d / gr);
        const idx = j * this.cols + i;
        this.data[idx] = clamp(this.data[idx] + dir * strength * 0.12 * fall, 0, 1);
      }
    }
  }

  /** Styled terrain raster (sea + glow + biomes + texture). */
  render(): HTMLCanvasElement {
    const { cols, rows, data, seaLevel, tex } = this;
    const pal = PALETTES[this.preset];
    const deep = hexToRgb(pal.deep), sea = hexToRgb(pal.sea), shallow = hexToRgb(pal.shallow);
    const glow = hexToRgb(pal.glow), sand = hexToRgb(pal.sand);
    const land = pal.land.map(hexToRgb);

    // Coastline glow: blur the land mask, the halo bleeds into the sea.
    const mask = new Float32Array(cols * rows);
    for (let k = 0; k < data.length; k++) mask[k] = data[k] >= seaLevel ? 1 : 0;
    const halo = boxBlur(mask, cols, rows, 3, 2);

    const cv = document.createElement('canvas');
    cv.width = cols; cv.height = rows;
    const ctx = cv.getContext('2d')!;
    const img = ctx.createImageData(cols, rows);
    const px = img.data;

    for (let k = 0; k < data.length; k++) {
      const e = data[k];
      let rgb: [number, number, number];
      if (e < seaLevel) {
        const t = smooth(clamp(e / seaLevel, 0, 1));         // 0 deep .. 1 shore
        const base = t < 0.6 ? lerpRgb(deep, sea, t / 0.6) : lerpRgb(sea, shallow, (t - 0.6) / 0.4);
        const h = clamp((halo[k] - 0.05) * 1.4, 0, 1) * 0.65; // glow strength near coast
        rgb = lerpRgb(base, glow, h);
      } else {
        const t = clamp((e - seaLevel) / (1 - seaLevel), 0, 1); // 0 coast .. 1 peak
        if (t < 0.03) {
          rgb = sand;
        } else {
          const f = t * (land.length - 1);
          const bi = Math.min(land.length - 2, Math.floor(f));
          rgb = lerpRgb(land[bi], land[bi + 1], f - bi);
          const v = 1 + tex[k] * 0.13;                         // mottle
          rgb = [rgb[0] * v, rgb[1] * v, rgb[2] * v];
        }
      }
      const o = k * 4;
      px[o] = clamp(rgb[0], 0, 255); px[o + 1] = clamp(rgb[1], 0, 255); px[o + 2] = clamp(rgb[2], 0, 255); px[o + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return cv;
  }

  /** Encode the grid to a compact grayscale PNG data-URL for persistence. */
  toDataURL(): string {
    const cv = document.createElement('canvas');
    cv.width = this.cols; cv.height = this.rows;
    const ctx = cv.getContext('2d')!;
    const img = ctx.createImageData(this.cols, this.rows);
    for (let k = 0; k < this.data.length; k++) {
      const v = clamp(Math.round(this.data[k] * 255), 0, 255);
      const o = k * 4;
      img.data[o] = v; img.data[o + 1] = v; img.data[o + 2] = v; img.data[o + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return cv.toDataURL('image/png');
  }

  /** Rebuild a heightmap from a stored grayscale PNG. */
  static fromDataURL(url: string, seaLevel: number, preset: BiomePreset): Promise<HeightMap> {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => {
        const cols = image.width, rows = image.height;
        const cv = document.createElement('canvas');
        cv.width = cols; cv.height = rows;
        const ctx = cv.getContext('2d')!;
        ctx.drawImage(image, 0, 0);
        const px = ctx.getImageData(0, 0, cols, rows).data;
        const data = new Float32Array(cols * rows);
        for (let k = 0; k < data.length; k++) data[k] = px[k * 4] / 255;
        resolve(new HeightMap(cols, rows, seaLevel, preset, data));
      };
      image.onerror = reject;
      image.src = url;
    });
  }
}

/* ── helpers ─────────────────────────────────────────────────────────────── */
function radialFalloff(nx: number, ny: number, shape: GenLikeParams['shape']): number {
  const d = Math.sqrt(nx * nx + ny * ny);
  if (shape === 'continent') return Math.max(0, (d - 0.15) * 0.85);
  if (shape === 'island') return Math.max(0, (d - 0.05) * 1.25);
  return Math.max(0, (d - 0.35) * 0.7);
}

function makeTexture(cols: number, rows: number): Float32Array {
  const noise = createNoise2D(mulberry32(1337));
  const out = new Float32Array(cols * rows);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const a = noise(i * 0.12, j * 0.12);
      const b = noise(i * 0.4, j * 0.4) * 0.4;
      out[j * cols + i] = clamp(a + b, -1, 1);
    }
  }
  return out;
}

function boxBlur(src: Float32Array, cols: number, rows: number, radius: number, passes: number): Float32Array {
  let a = src.slice();
  let b = new Float32Array(src.length);
  for (let p = 0; p < passes; p++) {
    // horizontal
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        let sum = 0; let n = 0;
        for (let k = -radius; k <= radius; k++) {
          const ii = i + k;
          if (ii < 0 || ii >= cols) continue;
          sum += a[j * cols + ii]; n++;
        }
        b[j * cols + i] = sum / n;
      }
    }
    [a, b] = [b, a];
    // vertical
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        let sum = 0; let n = 0;
        for (let k = -radius; k <= radius; k++) {
          const jj = j + k;
          if (jj < 0 || jj >= rows) continue;
          sum += a[jj * cols + i]; n++;
        }
        b[j * cols + i] = sum / n;
      }
    }
    [a, b] = [b, a];
  }
  return a;
}
