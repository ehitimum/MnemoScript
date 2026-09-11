import { describe, it, expect } from 'vitest';
import {
  parseMapDoc,
  createDefaultMapDoc,
  mapId,
  childLevel,
  regionLevelDef,
  regionLevelRank,
  mapKindDef,
  MAP_KINDS,
} from './mapTypes';

describe('createDefaultMapDoc', () => {
  it('new maps are hand-drawn with the decorative chrome on', () => {
    const d = createDefaultMapDoc('world');
    expect(d.style).toBe('handdrawn');
    expect(d.decor).toEqual({ frame: true, compass: true, cartouche: true });
    expect(d.canvas.width).toBe(mapKindDef('world').defaultSize.width);
    expect(Object.keys(d.layersMeta).sort()).toEqual(['items', 'labels', 'regions', 'routes', 'terrain']);
  });

  it('every registered kind has a usable default', () => {
    for (const k of MAP_KINDS) {
      const d = createDefaultMapDoc(k.id);
      expect(d.kind).toBe(k.id);
      expect(d.canvas.width).toBeGreaterThan(0);
    }
  });
});

describe('parseMapDoc', () => {
  it('returns a fresh document for empty or corrupt content', () => {
    expect(parseMapDoc('').kind).toBe('world');
    expect(parseMapDoc('not json at all').kind).toBe('world');
    expect(parseMapDoc('{"foo":1}').version).toBe(1);
  });

  it('migrates legacy maps (no style) to classic with no chrome so they look unchanged', () => {
    const legacy = JSON.stringify({ version: 1, kind: 'region', regions: [{ id: 'r1', name: 'Old', points: [0, 0, 10, 0, 10, 10] }] });
    const d = parseMapDoc(legacy);
    expect(d.kind).toBe('region');
    expect(d.style).toBe('classic');
    expect(d.decor).toEqual({ frame: false, compass: false, cartouche: false });
    expect(d.regions).toHaveLength(1);
    // defaults are filled for everything the old file lacked
    expect(d.items).toEqual([]);
    expect(d.imports).toEqual([]);
    expect(d.grid.type).toBe('none');
    expect(d.layersMeta.terrain.visible).toBe(true);
  });

  it('keeps an explicit hand-drawn style and partial decor', () => {
    const d = parseMapDoc(JSON.stringify({ version: 1, style: 'handdrawn', decor: { compass: true } }));
    expect(d.style).toBe('handdrawn');
    expect(d.decor).toEqual({ frame: false, compass: true, cartouche: false });
  });

  it('round-trips a full document', () => {
    const src = createDefaultMapDoc('region');
    src.labels.push({ id: 'l1', text: 'Here', x: 1, y: 2, size: 20, color: '#000', rotation: 0 });
    const out = parseMapDoc(JSON.stringify(src));
    expect(out).toEqual(src);
  });
});

describe('region tiers', () => {
  it('nest one step at a time and stop at county', () => {
    expect(childLevel(undefined)).toBe('province');
    expect(childLevel('realm')).toBe('province');
    expect(childLevel('province')).toBe('county');
    expect(childLevel('county')).toBe('county');
  });

  it('finer tiers rank higher (drawn on top) and have thinner borders', () => {
    expect(regionLevelRank('realm')).toBeLessThan(regionLevelRank('county'));
    expect(regionLevelDef('realm').width).toBeGreaterThan(regionLevelDef('county').width);
    expect(regionLevelDef(undefined).id).toBe('realm');
  });
});

describe('mapId', () => {
  it('is prefixed and unique', () => {
    const ids = new Set(Array.from({ length: 200 }, () => mapId('it')));
    expect(ids.size).toBe(200);
    for (const id of ids) expect(id.startsWith('it_')).toBe(true);
  });
});
