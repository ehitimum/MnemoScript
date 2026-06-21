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
import type { BiomePreset, MapStyle } from './mapTypes';

export const TERRAIN_COLS = 320;

/**
 * Terrain grid width scales with the map so brushes stay fine on big/4K maps
 * (a fixed grid would make each cell huge — and tiny brushes useless — at 4K).
 * Capped for render performance.
 */
export function terrainCols(w: number): number {
  return Math.max(360, Math.min(960, Math.round(w / 4.5)));
}

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

type RGB = [number, number, number];
function clamp(v: number, lo: number, hi: number): number { return v < lo ? lo : v > hi ? hi : v; }
function clamp01(v: number): number { return v < 0 ? 0 : v > 1 ? 1 : v; }
function smooth(t: number): number { return t * t * (3 - 2 * t); }
/** Source-over composite of a layer (la 0..1) onto an accumulator (0..255 + alpha 0..255). */
function over(r: number, g: number, b: number, a: number, lr: number, lg: number, lb: number, la: number) {
  const acc = a / 255;
  const outA = la + acc * (1 - la);
  if (outA <= 0) return { r: 0, g: 0, b: 0, a: 0 };
  const f = (cl: number, cAcc: number) => (cl * la + cAcc * acc * (1 - la)) / outA;
  return { r: f(lr, r), g: f(lg, g), b: f(lb, b), a: outA * 255 };
}
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
  style: MapStyle;       // which render path render() uses

  constructor(cols: number, rows: number, seaLevel: number, preset: BiomePreset, data?: Float32Array, style: MapStyle = 'classic') {
    this.cols = cols;
    this.rows = rows;
    this.seaLevel = seaLevel;
    this.preset = preset;
    this.style = style;
    this.data = data ?? new Float32Array(cols * rows);
    this.tex = makeTexture(cols, rows);
  }

  static blank(w: number, h: number, preset: BiomePreset, seaLevel = 0.4, style: MapStyle = 'classic'): HeightMap {
    const cols = terrainCols(w);
    const rows = Math.max(80, Math.round((cols * h) / w));
    return new HeightMap(cols, rows, seaLevel, preset, undefined, style);
  }

  /** Procedural fbm landmass shaped by a radial falloff. */
  static fromNoise(params: GenLikeParams, w: number, h: number, style: MapStyle = 'classic'): HeightMap {
    const cols = terrainCols(w);
    const rows = Math.max(80, Math.round((cols * h) / w));
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
    return new HeightMap(cols, rows, seaLevel, params.biomePreset, data, style);
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

  /**
   * Paint terrain under a circular brush. Rather than nudging by a fixed
   * increment (which makes small/quick strokes do nothing), each cell eases
   * toward a target elevation — land toward a hill above sea level, sea toward
   * open water below it — so a single decisive stroke reliably carves, even at
   * a 1-cell radius. A hard core + soft edge keeps tiny brushes (thin rivers)
   * crisp instead of mushy.
   */
  paint(cx: number, cy: number, radius: number, strength: number, raise: boolean, w: number, h: number): void {
    const gx = (cx / w) * this.cols;
    const gy = (cy / h) * this.rows;
    const gr = Math.max(0.85, (radius / w) * this.cols);
    const core = gr * 0.55;                 // inner full-strength radius
    const i0 = Math.max(0, Math.floor(gx - gr));
    const i1 = Math.min(this.cols - 1, Math.ceil(gx + gr));
    const j0 = Math.max(0, Math.floor(gy - gr));
    const j1 = Math.min(this.rows - 1, Math.ceil(gy + gr));
    // Targets sit a clear margin past sea level so the result actually reads as
    // land / water without slamming straight to the palette extremes.
    const target = raise ? Math.min(1, this.seaLevel + 0.4) : Math.max(0, this.seaLevel - 0.32);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const d = Math.hypot(i - gx, j - gy);
        if (d > gr) continue;
        const fall = d <= core ? 1 : smooth(clamp(1 - (d - core) / (gr - core + 1e-6), 0, 1));
        const t = clamp(strength * fall, 0, 1);
        const idx = j * this.cols + i;
        this.data[idx] = clamp(lerp(this.data[idx], target, t), 0, 1);
      }
    }
  }

  /** Styled terrain raster — dispatches on the chosen visual style. */
  render(): HTMLCanvasElement {
    return this.style === 'handdrawn' ? this.renderInk() : this.renderClassic();
  }

  /** Classic Inkarnate-style raster (sea depth + coastline glow + biomes + texture). */
  renderClassic(): HTMLCanvasElement {
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

  /**
   * Hand-drawn / parchment raster: the land is left bare (transparent) so the
   * paper shows through, the sea is a soft watercolour with concentric ripple
   * lines hugging the coast, a tan shore band seats the landmass, and high
   * ground gets a faint relief shadow. The crisp inked coastline itself is a
   * vector overlay (see {@link coastSegments}) drawn on the Konva stage.
   */
  renderInk(): HTMLCanvasElement {
    const { cols, rows, data, seaLevel, tex } = this;
    const dist = signedCoastDistance(data, cols, rows, seaLevel); // <0 land, >0 sea (cells)

    // Parchment-friendly palette (ink on paper).
    const seaCoast: RGB = [143, 185, 201];
    const seaOpen: RGB = [193, 217, 224];
    const ripple: RGB = [86, 130, 147];
    const sand: RGB = [216, 197, 158];
    const relief: RGB = [104, 84, 56];

    const cv = document.createElement('canvas');
    cv.width = cols; cv.height = rows;
    const ctx = cv.getContext('2d')!;
    const img = ctx.createImageData(cols, rows);
    const px = img.data;

    const RING = 8.5;          // ripple spacing in cells
    const RINGS = 4;           // how many ripple rings emanate from shore
    const SAND = 2.6;          // tan shore band width in cells

    for (let k = 0; k < data.length; k++) {
      const e = data[k];
      const d = dist[k];
      let r = 0, g = 0, b = 0, a = 0;

      if (e < seaLevel) {
        // ── open water ────────────────────────────────────────────────
        const fade = clamp(d / (RING * RINGS), 0, 1);
        let col = lerpRgb(seaCoast, seaOpen, fade);
        // concentric ripple lines, fading offshore
        if (d < RING * (RINGS + 0.5)) {
          const phase = Math.abs((d % RING) - 0) ; // distance past a ring
          const near = Math.min(phase, RING - phase);
          const line = smooth(clamp(1 - near / 1.3, 0, 1)) * (1 - fade) * 0.55;
          col = lerpRgb(col, ripple, line);
        }
        r = col[0]; g = col[1]; b = col[2]; a = 235;
      } else {
        // ── land: mostly bare paper, with a shore band + relief ───────
        const ld = -d; // distance inland from the coast (cells)
        // tan shore band
        if (ld < SAND) {
          const sa = smooth(1 - ld / SAND) * 0.55;
          ({ r, g, b, a } = over(r, g, b, a, sand[0], sand[1], sand[2], sa));
        }
        // faint relief shadow on higher ground (gives mountains some weight)
        const t = clamp((e - seaLevel) / (1 - seaLevel), 0, 1);
        const rel = clamp(t - 0.3, 0, 1);
        if (rel > 0) {
          const ra = rel * 0.17 * (0.7 + tex[k] * 0.3);
          ({ r, g, b, a } = over(r, g, b, a, relief[0], relief[1], relief[2], clamp01(ra)));
        }
      }

      const o = k * 4;
      px[o] = clamp(r, 0, 255); px[o + 1] = clamp(g, 0, 255); px[o + 2] = clamp(b, 0, 255); px[o + 3] = clamp(a, 0, 255);
    }
    ctx.putImageData(img, 0, 0);
    return cv;
  }

  /**
   * Marching-squares contour of the coastline (iso = seaLevel), returned as a
   * flat list of canvas-space segments [x0,y0,x1,y1, …]. Drawn as a crisp inked
   * line by the canvas, independent of the smoothed raster above.
   */
  coastSegments(w: number, h: number): number[] {
    const { cols, rows, data, seaLevel: L } = this;
    const out: number[] = [];
    const sx = w / (cols - 1);
    const sy = h / (rows - 1);
    for (let j = 0; j < rows - 1; j++) {
      for (let i = 0; i < cols - 1; i++) {
        const tl = data[j * cols + i];
        const tr = data[j * cols + i + 1];
        const bl = data[(j + 1) * cols + i];
        const br = data[(j + 1) * cols + i + 1];
        const c = (tl >= L ? 1 : 0) | (tr >= L ? 2 : 0) | (br >= L ? 4 : 0) | (bl >= L ? 8 : 0);
        if (c === 0 || c === 15) continue;
        // edge crossing points (grid space)
        const top = (): [number, number] => [i + (L - tl) / (tr - tl), j];
        const right = (): [number, number] => [i + 1, j + (L - tr) / (br - tr)];
        const bot = (): [number, number] => [i + (L - bl) / (br - bl), j + 1];
        const left = (): [number, number] => [i, j + (L - tl) / (bl - tl)];
        const seg = (p: [number, number], q: [number, number]) => out.push(p[0] * sx, p[1] * sy, q[0] * sx, q[1] * sy);
        switch (c) {
          case 1: case 14: seg(left(), top()); break;
          case 2: case 13: seg(top(), right()); break;
          case 3: case 12: seg(left(), right()); break;
          case 4: case 11: seg(right(), bot()); break;
          case 6: case 9: seg(top(), bot()); break;
          case 7: case 8: seg(left(), bot()); break;
          case 5: seg(left(), top()); seg(right(), bot()); break;   // saddle
          case 10: seg(top(), right()); seg(left(), bot()); break;  // saddle
        }
      }
    }
    return out;
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
  static fromDataURL(url: string, seaLevel: number, preset: BiomePreset, style: MapStyle = 'classic'): Promise<HeightMap> {
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
        resolve(new HeightMap(cols, rows, seaLevel, preset, data, style));
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

/** Two-pass chamfer distance transform: distance (in cells) to nearest source. */
function chamfer(source: Uint8Array, cols: number, rows: number): Float32Array {
  const INF = 1e9;
  const O = 1, D = Math.SQRT2;
  const d = new Float32Array(cols * rows);
  for (let k = 0; k < d.length; k++) d[k] = source[k] ? 0 : INF;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const k = j * cols + i;
      let v = d[k];
      if (i > 0) v = Math.min(v, d[k - 1] + O);
      if (j > 0) v = Math.min(v, d[k - cols] + O);
      if (i > 0 && j > 0) v = Math.min(v, d[k - cols - 1] + D);
      if (i < cols - 1 && j > 0) v = Math.min(v, d[k - cols + 1] + D);
      d[k] = v;
    }
  }
  for (let j = rows - 1; j >= 0; j--) {
    for (let i = cols - 1; i >= 0; i--) {
      const k = j * cols + i;
      let v = d[k];
      if (i < cols - 1) v = Math.min(v, d[k + 1] + O);
      if (j < rows - 1) v = Math.min(v, d[k + cols] + O);
      if (i < cols - 1 && j < rows - 1) v = Math.min(v, d[k + cols + 1] + D);
      if (i > 0 && j < rows - 1) v = Math.min(v, d[k + cols - 1] + D);
      d[k] = v;
    }
  }
  return d;
}

/** Signed distance to the coastline: negative on land, positive in sea (cells). */
function signedCoastDistance(data: Float32Array, cols: number, rows: number, seaLevel: number): Float32Array {
  const land = new Uint8Array(cols * rows);
  const sea = new Uint8Array(cols * rows);
  for (let k = 0; k < land.length; k++) { if (data[k] >= seaLevel) land[k] = 1; else sea[k] = 1; }
  const dl = chamfer(land, cols, rows); // sea cells → distance into the water
  const ds = chamfer(sea, cols, rows);  // land cells → distance inland
  const out = new Float32Array(cols * rows);
  for (let k = 0; k < out.length; k++) out[k] = data[k] >= seaLevel ? -ds[k] : dl[k];
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
