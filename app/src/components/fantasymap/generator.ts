/**
 * Procedural map generation.
 *
 * Pipeline (all seeded → fully reproducible from GenParams):
 *   1. fbm simplex heightmap on a coarse grid, shaped by a radial falloff
 *      (island / continent / archipelago) and thresholded into land/sea.
 *   2. Quantise elevation(+latitude) into biome bands → paint an offscreen
 *      raster the canvas uses as its terrain background image.
 *   3. Scatter seed points on land → Voronoi (d3-delaunay) → named regions.
 *   4. Scatter matching library icons (mountains high, forest mid, settlements
 *      near the coast) by biome band.
 *
 * Only the params + seed are persisted; this module re-derives the raster on
 * load so documents stay tiny.
 */
import { createNoise2D } from 'simplex-noise';
import { Delaunay } from 'd3-delaunay';
import type { GenParams, BiomePreset, MapRegion, MapItem } from './mapTypes';
import { mapId } from './mapTypes';
import { SCATTER_SETS } from './iconLibrary';

/* ── seeded RNG ─────────────────────────────────────────────────────────── */
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

/* ── biome palettes (cold → warm, sea → peak) ───────────────────────────── */
interface Palette {
  deep: string; sea: string; shallow: string; sand: string;
  land: string[]; // low → high land bands
}

const PALETTES: Record<BiomePreset, Palette> = {
  temperate: {
    deep: '#2f5a78', sea: '#3a6c8c', shallow: '#5b9bb5', sand: '#d9c89a',
    land: ['#9bb56a', '#86a857', '#6f9a4c', '#5d8a44', '#8a8d5a', '#9a9384', '#cfcabe', '#ffffff'],
  },
  arid: {
    deep: '#2c5066', sea: '#3a6478', shallow: '#5f97a3', sand: '#e6d3a3',
    land: ['#d8c081', '#cbab63', '#c0974b', '#b07f3c', '#9a6c34', '#8a8170', '#bcb6a6', '#ffffff'],
  },
  arctic: {
    deep: '#33546b', sea: '#456f86', shallow: '#79a7bd', sand: '#cfd6cf',
    land: ['#c9d4cf', '#b6c6c2', '#a4b8b6', '#9fb0b3', '#b3c0c6', '#cdd6da', '#e6ecef', '#ffffff'],
  },
  volcanic: {
    deep: '#2a2330', sea: '#3b2f3d', shallow: '#5c4753', sand: '#5a4a44',
    land: ['#6a5750', '#7a5a4a', '#8a5740', '#9a4f34', '#7d3a2a', '#5c2c22', '#3c1f1a', '#1f1413'],
  },
  verdant: {
    deep: '#1f6b66', sea: '#2c8a7e', shallow: '#54b39c', sand: '#e3d6a0',
    land: ['#86c06a', '#6db257', '#56a14a', '#42903f', '#36803a', '#5e7d4a', '#9aa182', '#e8ead8'],
  },
};

/* ── heightmap ──────────────────────────────────────────────────────────── */
export interface HeightField {
  w: number; h: number; cols: number; rows: number;
  height: Float32Array;   // 0..1 (sea below `seaLevel`)
  seaLevel: number;
  at(x: number, y: number): number; // sample in canvas px
  isLand(x: number, y: number): boolean;
}

function radialFalloff(nx: number, ny: number, shape: GenParams['shape']): number {
  // nx,ny in -1..1 from centre. Returns subtractive falloff 0..1.
  const d = Math.sqrt(nx * nx + ny * ny);
  if (shape === 'continent') return Math.max(0, (d - 0.15) * 0.85);
  if (shape === 'island') return Math.max(0, (d - 0.05) * 1.25);
  // archipelago: weaker, wavy falloff so multiple landmasses survive
  return Math.max(0, (d - 0.35) * 0.7);
}

export function buildHeightField(params: GenParams, w: number, h: number): HeightField {
  const cols = 320;
  const rows = Math.max(80, Math.round((cols * h) / w));
  const rng = mulberry32(params.seed || 1);
  const noise = createNoise2D(rng);
  const octaves = Math.max(1, Math.round(params.roughness));
  const field = new Float32Array(cols * rows);

  let min = Infinity;
  let max = -Infinity;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const nx = (i / cols) * 2 - 1;
      const ny = (j / rows) * 2 - 1;
      let amp = 1;
      let freq = 1.7;
      let val = 0;
      let norm = 0;
      for (let o = 0; o < octaves; o++) {
        val += amp * noise((nx * freq + 4) * 1.1, (ny * freq + 4) * 1.1);
        norm += amp;
        amp *= 0.5;
        freq *= 2;
      }
      let e = (val / norm) * 0.5 + 0.5;        // 0..1
      e -= radialFalloff(nx, ny, params.shape); // carve seas at edges
      if (params.shape === 'archipelago') {
        // break the interior up so it reads as many isles
        e -= Math.max(0, noise(nx * 3.3, ny * 3.3)) * 0.25;
      }
      field[j * cols + i] = e;
      if (e < min) min = e;
      if (e > max) max = e;
    }
  }
  // normalise to 0..1
  const span = max - min || 1;
  for (let k = 0; k < field.length; k++) field[k] = (field[k] - min) / span;

  // sea level chosen so ~landAmount of the map is land
  const seaLevel = 1 - clamp(params.landAmount, 0.1, 0.92);

  const at = (x: number, y: number) => {
    const i = clamp(Math.floor((x / w) * cols), 0, cols - 1);
    const j = clamp(Math.floor((y / h) * rows), 0, rows - 1);
    return field[j * cols + i];
  };
  return {
    w, h, cols, rows, height: field, seaLevel, at,
    isLand: (x, y) => at(x, y) >= seaLevel,
  };
}

/* ── render terrain raster ──────────────────────────────────────────────── */
export function renderTerrainCanvas(params: GenParams, hf: HeightField): HTMLCanvasElement {
  const pal = PALETTES[params.biomePreset];
  const bands = clamp(Math.round(params.biomeCount), 2, 10);
  const cv = document.createElement('canvas');
  // Render at grid resolution then let the canvas upscale (smooth, cheap, small).
  cv.width = hf.cols;
  cv.height = hf.rows;
  const ctx = cv.getContext('2d')!;
  const img = ctx.createImageData(hf.cols, hf.rows);
  const data = img.data;

  for (let j = 0; j < hf.rows; j++) {
    for (let i = 0; i < hf.cols; i++) {
      const e = hf.height[j * hf.cols + i];
      let col: string;
      if (e < hf.seaLevel) {
        const t = e / hf.seaLevel;            // 0 deepest .. 1 shoreline
        col = t < 0.55 ? pal.deep : t < 0.85 ? pal.sea : pal.shallow;
      } else {
        const t = (e - hf.seaLevel) / (1 - hf.seaLevel); // 0 coast .. 1 peak
        if (t < 0.04) col = pal.sand;
        else {
          const band = Math.min(pal.land.length - 1, Math.floor(t * bands * (pal.land.length / bands)));
          col = pal.land[clamp(band, 0, pal.land.length - 1)];
        }
      }
      const [r, g, b] = hexToRgb(col);
      const idx = (j * hf.cols + i) * 4;
      data[idx] = r; data[idx + 1] = g; data[idx + 2] = b; data[idx + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return cv;
}

/* ── regions (Voronoi) ──────────────────────────────────────────────────── */
export function generateRegions(params: GenParams, hf: HeightField): MapRegion[] {
  const count = clamp(Math.round(params.regionCount), 0, 60);
  if (count === 0) return [];
  const rng = mulberry32((params.seed || 1) ^ 0x9e3779b9);
  const pts: number[][] = [];
  let guard = 0;
  while (pts.length < count && guard++ < count * 200) {
    const x = rng() * hf.w;
    const y = rng() * hf.h;
    if (hf.isLand(x, y)) pts.push([x, y]);
  }
  if (pts.length < 2) return [];
  const delaunay = Delaunay.from(pts);
  const voronoi = delaunay.voronoi([0, 0, hf.w, hf.h]);
  const regions: MapRegion[] = [];
  for (let i = 0; i < pts.length; i++) {
    const poly = voronoi.cellPolygon(i);
    if (!poly || poly.length < 3) continue;
    const flat: number[] = [];
    for (const [px, py] of poly) flat.push(px, py);
    regions.push({
      id: mapId('reg'),
      name: fantasyName(rng),
      points: flat,
      fill: regionTint(i),
      stroke: '#6b5a3e',
      opacity: 0.28,
      z: i,
      labelPos: { x: pts[i][0], y: pts[i][1] },
    });
  }
  return regions;
}

/* ── icon scatter ───────────────────────────────────────────────────────── */
export function scatterIcons(params: GenParams, hf: HeightField): MapItem[] {
  if (params.scatterDensity <= 0) return [];
  const rng = mulberry32((params.seed || 1) ^ 0x85ebca6b);
  const items: MapItem[] = [];
  // Denser = smaller step, but floored so a max-density generate can't spawn
  // thousands of canvas nodes; also hard-capped below.
  const step = Math.round(70 - params.scatterDensity * 34); // 36..70
  const CAP = 600;
  const jitter = step * 0.5;
  let z = 0;

  const place = (x: number, y: number, set: string[], size: number) => {
    const libId = set[Math.floor(rng() * set.length)];
    items.push({
      id: mapId('it'), libId, x, y,
      width: size, height: size, scale: 1,
      rotation: 0, z: z++, tint: '#3a2f23',
    });
  };

  for (let y = step; y < hf.h - step && items.length < CAP; y += step) {
    for (let x = step; x < hf.w - step && items.length < CAP; x += step) {
      const jx = x + (rng() - 0.5) * jitter;
      const jy = y + (rng() - 0.5) * jitter;
      if (!hf.isLand(jx, jy)) continue;
      const e = hf.at(jx, jy);
      const t = (e - hf.seaLevel) / (1 - hf.seaLevel); // 0 coast .. 1 peak
      const roll = rng();

      if (params.scatterTerrain && t > 0.66 && roll < 0.7) {
        place(jx, jy, SCATTER_SETS.mountains, 46);
      } else if (params.scatterTerrain && t > 0.28 && t <= 0.66 && roll < 0.4) {
        const set = params.biomePreset === 'arid' ? SCATTER_SETS.desert : SCATTER_SETS.forest;
        place(jx, jy, set, 38);
      } else if (params.scatterSettlements && t <= 0.28 && roll < 0.16) {
        // near the coast → bias towards settlements, occasionally a city
        place(jx, jy, rng() < 0.2 ? SCATTER_SETS.city : SCATTER_SETS.settlement, rng() < 0.2 ? 50 : 40);
      }
    }
  }
  return items;
}

/* ── fantasy name generator ─────────────────────────────────────────────── */
const STARTS = ['Aval', 'Bryn', 'Cael', 'Dun', 'Eld', 'Fen', 'Gor', 'Hel', 'Ish', 'Kar', 'Lor', 'Mor', 'Nor', 'Oth', 'Quel', 'Rav', 'Syl', 'Thal', 'Vor', 'Wyn', 'Zan'];
const MIDS = ['a', 'e', 'i', 'o', 'u', 'ae', 'or', 'an', 'el', 'ar', 'en', 'il', 'ow', 'ys'];
const ENDS = ['mor', 'dell', 'gard', 'wood', 'fell', 'reach', 'mere', 'hold', 'vale', 'spire', 'march', 'haven', 'crest', 'fall', 'wick', 'thorn'];

export function fantasyName(rng: () => number): string {
  const pick = <T,>(a: T[]) => a[Math.floor(rng() * a.length)];
  let n = pick(STARTS) + pick(MIDS) + pick(ENDS);
  if (rng() < 0.25) n += ' ' + pick(['Reach', 'Wilds', 'Marches', 'Expanse', 'Vale', 'Reaches']);
  return n;
}

/* ── helpers ────────────────────────────────────────────────────────────── */
function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function hexToRgb(hex: string): [number, number, number] {
  const m = hex.replace('#', '');
  const n = parseInt(m.length === 3 ? m.replace(/(.)/g, '$1$1') : m, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const REGION_TINTS = ['#b4543e', '#3e7bb4', '#5aa05a', '#b49a3e', '#8a5ab4', '#3eb4a0', '#b43e84', '#7a6a4a'];
function regionTint(i: number): string {
  return REGION_TINTS[i % REGION_TINTS.length];
}

/** Run the whole pipeline; returns the pieces FantasyMap writes into the doc. */
export function generateMap(params: GenParams, w: number, h: number) {
  const hf = buildHeightField(params, w, h);
  return {
    hf,
    regions: generateRegions(params, hf),
    items: scatterIcons(params, hf),
  };
}
