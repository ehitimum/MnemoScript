/**
 * Procedural map generation, layered on top of the paintable {@link HeightMap}.
 *
 *   1. HeightMap.fromNoise → fbm landmass shaped by a radial falloff.
 *   2. (rendering / biomes now live in heightmap.ts)
 *   3. Voronoi (d3-delaunay) over land seed points → named regions.
 *   4. Scatter matching library icons by elevation band.
 *
 * The heightmap is the single source of truth for terrain, shared with the
 * landmass brush, so a generated map is fully paintable afterwards.
 */
import { Delaunay } from 'd3-delaunay';
import type { GenParams, MapRegion, MapItem } from './mapTypes';
import { mapId } from './mapTypes';
import { SCATTER_SETS } from './iconLibrary';
import { INK_SCATTER_SETS, INK_DARK } from './inkIcons';
import { HeightMap, mulberry32, randomSeed } from './heightmap';

export { mulberry32, randomSeed, HeightMap };

function clamp(v: number, lo: number, hi: number): number { return v < lo ? lo : v > hi ? hi : v; }

/* ── regions (Voronoi) ──────────────────────────────────────────────────── */
export function generateRegions(params: GenParams, hm: HeightMap, w: number, h: number): MapRegion[] {
  const count = clamp(Math.round(params.regionCount), 0, 60);
  if (count === 0) return [];
  const rng = mulberry32((params.seed || 1) ^ 0x9e3779b9);
  const pts: number[][] = [];
  let guard = 0;
  while (pts.length < count && guard++ < count * 200) {
    const x = rng() * w;
    const y = rng() * h;
    if (hm.isLand(x, y, w, h)) pts.push([x, y]);
  }
  if (pts.length < 2) return [];
  const ink = params.style === 'handdrawn';
  const delaunay = Delaunay.from(pts);
  const voronoi = delaunay.voronoi([0, 0, w, h]);
  const regions: MapRegion[] = [];
  for (let i = 0; i < pts.length; i++) {
    const poly = voronoi.cellPolygon(i);
    if (!poly || poly.length < 3) continue;
    const flat: number[] = [];
    for (const [px, py] of poly) flat.push(px, py);
    regions.push({
      id: mapId('reg'),
      name: fantasyName(rng),
      // Hand-drawn maps want named areas without loud colour fills (the demo
      // shows labels, not blocks); the classic style keeps the tinted regions.
      points: flat,
      fill: ink ? '#b98e52' : regionTint(i),
      stroke: ink ? '#7c5c34' : '#6b5a3e',
      opacity: ink ? 0.1 : 0.26,
      z: i,
      labelPos: { x: pts[i][0], y: pts[i][1] },
    });
  }
  return regions;
}

/* ── icon scatter ───────────────────────────────────────────────────────── */
export function scatterIcons(params: GenParams, hm: HeightMap, w: number, h: number): MapItem[] {
  if (params.scatterDensity <= 0) return [];
  const rng = mulberry32((params.seed || 1) ^ 0x85ebca6b);
  const ink = params.style === 'handdrawn';
  const sets = ink ? INK_SCATTER_SETS : SCATTER_SETS;
  const tint = ink ? INK_DARK : '#3a2f23';
  const items: MapItem[] = [];
  const step = Math.round(70 - params.scatterDensity * 34); // 36..70
  const CAP = 600;
  const jitter = step * 0.5;
  let z = 0;

  const place = (x: number, y: number, set: string[], size: number, label?: string) => {
    const libId = set[Math.floor(rng() * set.length)];
    items.push({ id: mapId('it'), libId, x, y, width: size, height: size, scale: 1, rotation: 0, z: z++, tint, label });
  };

  // A short mountain range: a few overlapping peaks along a jittered ridge line
  // so highlands read as a massif rather than scattered single icons.
  const placeRange = (x: number, y: number, size: number) => {
    const n = 2 + Math.floor(rng() * 3);
    const ang = rng() * Math.PI;
    const dx = Math.cos(ang), dy = Math.sin(ang) * 0.5;
    for (let s = 0; s < n && items.length < CAP; s++) {
      const off = (s - (n - 1) / 2) * size * 0.62;
      const px = x + dx * off + (rng() - 0.5) * size * 0.25;
      const py = y + dy * off + (rng() - 0.5) * size * 0.25;
      if (!hm.isLand(px, py, w, h)) continue;
      place(px, py, sets.mountains, size * (0.85 + rng() * 0.4));
    }
  };

  for (let y = step; y < h - step && items.length < CAP; y += step) {
    for (let x = step; x < w - step && items.length < CAP; x += step) {
      const jx = x + (rng() - 0.5) * jitter;
      const jy = y + (rng() - 0.5) * jitter;
      if (!hm.isLand(jx, jy, w, h)) continue;
      const e = hm.at(jx, jy, w, h);
      const t = (e - hm.seaLevel) / (1 - hm.seaLevel);
      const roll = rng();
      if (params.scatterTerrain && t > 0.66 && roll < 0.7) {
        if (ink) placeRange(jx, jy, 48);
        else place(jx, jy, sets.mountains, 46);
      } else if (params.scatterTerrain && t > 0.28 && t <= 0.66 && roll < 0.4) {
        const set = params.biomePreset === 'arid' ? sets.desert : sets.forest;
        place(jx, jy, set, 38);
      } else if (params.scatterSettlements && t <= 0.28 && roll < 0.16) {
        const city = rng() < 0.2;
        // hand-drawn maps caption their settlements (red place names); the
        // classic style leaves them unlabelled to avoid clutter.
        const label = ink && (city || rng() < 0.5) ? fantasyName(rng) : undefined;
        place(jx, jy, city ? sets.city : sets.settlement, city ? 50 : 40, label);
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

const REGION_TINTS = ['#b4543e', '#3e7bb4', '#5aa05a', '#b49a3e', '#8a5ab4', '#3eb4a0', '#b43e84', '#7a6a4a'];
function regionTint(i: number): string { return REGION_TINTS[i % REGION_TINTS.length]; }

/** Run the whole pipeline; returns the heightmap + the pieces written to the doc. */
export function generateMap(params: GenParams, w: number, h: number) {
  const hm = HeightMap.fromNoise(params, w, h, params.style);
  return { hm, regions: generateRegions(params, hm, w, h), items: scatterIcons(params, hm, w, h) };
}
