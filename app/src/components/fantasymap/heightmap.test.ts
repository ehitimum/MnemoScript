import { describe, it, expect } from 'vitest';
import { HeightMap, mulberry32, terrainCols, randomSeed } from './heightmap';

const W = 1200;
const H = 800;
const params = { shape: 'continent' as const, seed: 42, landAmount: 0.5, roughness: 4, biomePreset: 'temperate' as const };

describe('terrainCols', () => {
  it('scales with the map width inside the [400, 1024] clamp', () => {
    expect(terrainCols(800)).toBe(400);
    expect(terrainCols(1920)).toBe(512);
    expect(terrainCols(3840)).toBe(1024);
    expect(terrainCols(20000)).toBe(1024);
  });
});

describe('mulberry32 / randomSeed', () => {
  it('is deterministic for a seed and different across seeds', () => {
    const a = mulberry32(7);
    const b = mulberry32(7);
    const c = mulberry32(8);
    const sa = [a(), a(), a()];
    expect([b(), b(), b()]).toEqual(sa);
    expect([c(), c(), c()]).not.toEqual(sa);
    sa.forEach((v) => expect(v).toBeGreaterThanOrEqual(0));
    sa.forEach((v) => expect(v).toBeLessThan(1));
  });

  it('randomSeed produces 32-bit non-negative integers', () => {
    for (let i = 0; i < 20; i++) {
      const s = randomSeed();
      expect(Number.isInteger(s)).toBe(true);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(0xffffffff);
    }
  });
});

describe('HeightMap.fromNoise', () => {
  it('is deterministic per seed and normalised to 0..1', () => {
    const a = HeightMap.fromNoise(params, W, H);
    const b = HeightMap.fromNoise(params, W, H);
    expect(Array.from(a.data.slice(0, 50))).toEqual(Array.from(b.data.slice(0, 50)));
    let min = Infinity;
    let max = -Infinity;
    for (const v of a.data) {
      if (v < min) min = v;
      if (v > max) max = v;
    }
    expect(min).toBeCloseTo(0, 5);
    expect(max).toBeCloseTo(1, 5);
  });

  it('derives the sea level from landAmount and sizes the grid from the map', () => {
    const hm = HeightMap.fromNoise(params, W, H);
    expect(hm.seaLevel).toBeCloseTo(0.5, 5);
    expect(hm.cols).toBe(terrainCols(W));
    expect(hm.rows).toBe(Math.round((hm.cols * H) / W));
  });

  it('a continent has both land and sea', () => {
    const hm = HeightMap.fromNoise(params, W, H);
    let land = 0;
    let sea = 0;
    for (let y = 0; y < H; y += 40) {
      for (let x = 0; x < W; x += 40) {
        if (hm.isLand(x, y, W, H)) land++;
        else sea++;
      }
    }
    expect(land).toBeGreaterThan(0);
    expect(sea).toBeGreaterThan(0);
  });
});

describe('HeightMap.paint', () => {
  it('a decisive land stroke raises the ground above sea level; the sea brush carves it back', () => {
    const hm = HeightMap.blank(W, H, 'temperate', 0.4);
    expect(hm.isLand(600, 400, W, H)).toBe(false);
    hm.paint(600, 400, 80, 1, true, W, H);
    expect(hm.isLand(600, 400, W, H)).toBe(true);
    // the edge of the brush is untouched
    expect(hm.isLand(600 + 400, 400, W, H)).toBe(false);
    hm.paint(600, 400, 80, 1, false, W, H, 0.34);
    expect(hm.isLand(600, 400, W, H)).toBe(false);
  });

  it('even a tiny brush (thin river) carves reliably', () => {
    const hm = HeightMap.blank(W, H, 'temperate', 0.4);
    hm.paint(300, 300, 120, 1, true, W, H); // make land first
    expect(hm.isLand(300, 300, W, H)).toBe(true);
    hm.paint(300, 300, 3, 0.7, false, W, H, 0.12);
    hm.paint(300, 300, 3, 0.7, false, W, H, 0.12);
    expect(hm.isLand(300, 300, W, H)).toBe(false);
  });
});

describe('coastline extraction', () => {
  it('coastSegments come in [x0,y0,x1,y1] quads inside the canvas', () => {
    const hm = HeightMap.fromNoise(params, W, H);
    const segs = hm.coastSegments(W, H);
    expect(segs.length).toBeGreaterThan(0);
    expect(segs.length % 4).toBe(0);
    for (let i = 0; i < segs.length; i += 2) {
      expect(segs[i]).toBeGreaterThanOrEqual(-1);
      expect(segs[i]).toBeLessThanOrEqual(W + 1);
      expect(segs[i + 1]).toBeGreaterThanOrEqual(-1);
      expect(segs[i + 1]).toBeLessThanOrEqual(H + 1);
    }
  });

  it('coastPolylines chains segments into smooth polylines (fewer, longer paths)', () => {
    const hm = HeightMap.fromNoise(params, W, H);
    const segs = hm.coastSegments(W, H);
    const polys = hm.coastPolylines(W, H);
    expect(polys.length).toBeGreaterThan(0);
    expect(polys.length).toBeLessThan(segs.length / 4); // chaining actually joined things
    for (const p of polys) {
      expect(p.length % 2).toBe(0);
      expect(p.length).toBeGreaterThanOrEqual(6);
      for (const v of p) expect(Number.isFinite(v)).toBe(true);
    }
  });
});

describe('ruggedness (domain warp)', () => {
  it('is a no-op at 0 and reshapes the field when raised', () => {
    const hm = HeightMap.fromNoise(params, W, H);
    expect(hm.effData()).toBe(hm.data); // identity, zero cost
    const before = Array.from(hm.effData().slice(1000, 1100));
    hm.ruggedness = 1;
    const after = Array.from(hm.effData().slice(1000, 1100));
    expect(after).not.toEqual(before);
    expect(hm.effData()).not.toBe(hm.data);
    hm.ruggedness = 0;
    expect(hm.effData()).toBe(hm.data);
  });

  it('painting invalidates the warped cache', () => {
    const hm = HeightMap.fromNoise(params, W, H);
    hm.ruggedness = 0.6;
    const cached = hm.effData();
    expect(hm.effData()).toBe(cached);
    hm.paint(600, 400, 150, 1, true, W, H);
    const v = hm.at(600, 400, W, H);
    expect(v).toBeGreaterThanOrEqual(hm.seaLevel);
  });
});
