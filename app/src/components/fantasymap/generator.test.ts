import { describe, it, expect } from 'vitest';
import { generateMap, generateRegions, scatterIcons, fantasyName } from './generator';
import { mulberry32 } from './heightmap';
import { DEFAULT_GEN_PARAMS, type GenParams } from './mapTypes';

const W = 1400;
const H = 1000;
const base: GenParams = { ...DEFAULT_GEN_PARAMS, seed: 1234, regionCount: 8, scatterDensity: 0.5 };

describe('generateMap', () => {
  it('is fully reproducible from seed + params', () => {
    const a = generateMap(base, W, H);
    const b = generateMap(base, W, H);
    expect(a.regions.map((r) => r.name)).toEqual(b.regions.map((r) => r.name));
    expect(a.items.length).toBe(b.items.length);
    expect(a.items.map((i) => [i.libId, Math.round(i.x), Math.round(i.y)])).toEqual(
      b.items.map((i) => [i.libId, Math.round(i.x), Math.round(i.y)]),
    );
  });

  it('a different seed gives a different world', () => {
    const a = generateMap(base, W, H);
    const b = generateMap({ ...base, seed: 4321 }, W, H);
    expect(a.regions.map((r) => r.name)).not.toEqual(b.regions.map((r) => r.name));
  });

  it('never places more regions than asked and puts every icon on land', () => {
    const { hm, regions, items } = generateMap(base, W, H);
    expect(regions.length).toBeLessThanOrEqual(base.regionCount);
    expect(regions.length).toBeGreaterThan(0);
    expect(items.length).toBeGreaterThan(0);
    for (const it of items) expect(hm.isLand(it.x, it.y, W, H)).toBe(true);
  });

  it('honours the scatter toggles', () => {
    const none = generateMap({ ...base, scatterDensity: 0 }, W, H);
    expect(none.items).toHaveLength(0);
    const noRegions = generateRegions({ ...base, regionCount: 0 }, none.hm, W, H);
    expect(noRegions).toHaveLength(0);
  });

  it('hand-drawn maps caption some settlements; classic maps do not', () => {
    const ink = generateMap({ ...base, style: 'handdrawn' }, W, H);
    const classic = generateMap({ ...base, style: 'classic' }, W, H);
    expect(ink.items.some((i) => !!i.label)).toBe(true);
    expect(classic.items.every((i) => !i.label)).toBe(true);
    expect(ink.items.every((i) => i.libId?.startsWith('ink-'))).toBe(true);
  });

  it('scatter density controls the icon count', () => {
    const { hm } = generateMap(base, W, H);
    const sparse = scatterIcons({ ...base, scatterDensity: 0.1 }, hm, W, H).length;
    const dense = scatterIcons({ ...base, scatterDensity: 1 }, hm, W, H).length;
    expect(dense).toBeGreaterThan(sparse);
    expect(dense).toBeLessThanOrEqual(600); // hard cap
  });
});

describe('fantasyName', () => {
  it('produces capitalised, non-empty names deterministically', () => {
    const n1 = fantasyName(mulberry32(9));
    const n2 = fantasyName(mulberry32(9));
    expect(n1).toBe(n2);
    expect(n1.length).toBeGreaterThan(3);
    expect(n1[0]).toBe(n1[0].toUpperCase());
  });
});
