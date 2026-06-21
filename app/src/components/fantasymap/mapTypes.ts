/**
 * Data model for a Fantasy Map document. The whole thing is serialised to a
 * JSON string and stored in `Document.content` (exactly like MindMap stores
 * `{nodes,edges}`). Items reference EITHER a bundled library icon (`libId`) or
 * an imported on-disk asset (`assetPath`) — never the raw image bytes — so the
 * persisted content stays small and portable.
 *
 * The procedurally generated terrain is NOT baked into the JSON: we store only
 * the `seed` + `params` and re-render the raster deterministically on load. That
 * keeps documents tiny no matter how detailed the map looks.
 */

export type MapKind = 'world' | 'region';

/**
 * Visual engine style. Both render paths ship side-by-side:
 *  • 'classic'   — the Inkarnate-style coloured terrain (sea depth, coastline
 *                  glow, elevation-banded biomes, mottled land texture).
 *  • 'handdrawn' — the parchment ink look (bare-paper land, an inked coastline
 *                  with concentric water ripples, faint relief shading) plus a
 *                  hand-drawn icon set and an optional decorative frame.
 */
export type MapStyle = 'classic' | 'handdrawn';

/** Decorative "map chrome" drawn on top of everything (hand-drawn style). */
export interface MapDecor {
  frame: boolean;     // ornate double border with corner flourishes
  compass: boolean;   // compass rose in a corner
  cartouche: boolean; // title banner at the top
}

export type LayerId = 'terrain' | 'regions' | 'routes' | 'items' | 'labels';

export interface MapBackground {
  /** 'parchment' is a generated paper texture; 'image' references an asset path. */
  type: 'color' | 'parchment' | 'image';
  value: string;
}

export interface MapGrid {
  type: 'none' | 'square' | 'hex';
  size: number;
  color: string;
  opacity: number;
  snap: boolean;
}

/** A stamped icon — a bundled library glyph or an imported image. */
export interface MapItem {
  id: string;
  libId?: string;     // id into the bundled icon library (see iconLibrary.ts)
  assetPath?: string; // imported asset (resolved to a URL via mapAssets.toItemUrl)
  x: number;
  y: number;
  width: number;      // base pixel size (pre-scale)
  height: number;
  scale: number;      // uniform scale multiplier
  rotation: number;   // degrees
  z: number;          // z-order within the items layer
  tint?: string;      // hex recolour for library (SVG) icons
  flipX?: boolean;
  label?: string;     // optional caption rendered under the icon
  locked?: boolean;
}

/** Administrative tier of a region — drives border weight/dash + label size. */
export type RegionLevel = 'realm' | 'province' | 'county';

/** A named area drawn as a (border-first) polygon, optionally nested under a parent. */
export interface MapRegion {
  id: string;
  name: string;
  points: number[];   // flat [x0,y0,x1,y1,…]
  fill: string;
  stroke: string;
  opacity: number;
  z: number;
  level?: RegionLevel;   // tier (default 'realm'); styles the border + label
  parentId?: string;     // containing region (country → state → county)
  showFill?: boolean;    // paint the faint fill? default false = border only
  labelPos?: { x: number; y: number };
  locked?: boolean;
}

/** A poly-line: road, river or political border. */
export interface MapRoute {
  id: string;
  kind: 'road' | 'river' | 'border';
  points: number[];
  color: string;
  width: number;
  dashed?: boolean;
  z: number;
  locked?: boolean;
}

export interface MapLabel {
  id: string;
  text: string;
  x: number;
  y: number;
  size: number;
  color: string;
  rotation: number;
  bold?: boolean;
  locked?: boolean;
}

export type GenShape = 'island' | 'continent' | 'archipelago';
export type BiomePreset = 'temperate' | 'arid' | 'arctic' | 'volcanic' | 'verdant';

/** Everything the Auto-Generation menu collects. A generation is fully
 *  reproducible from these values + the seed. */
export interface GenParams {
  style: MapStyle;          // which render engine to produce
  shape: GenShape;
  seed: number;
  landAmount: number;       // 0..1 — higher means more land above sea level
  roughness: number;        // 1..6 fbm octaves (coastline detail)
  biomePreset: BiomePreset;
  biomeCount: number;       // 2..10 elevation bands the palette is quantised to
  regionCount: number;      // 0..60 named Voronoi regions
  scatterDensity: number;   // 0..1 overall icon scatter amount
  scatterSettlements: boolean;
  scatterTerrain: boolean;
}

export interface TerrainState {
  mode: 'generated' | 'painted' | 'image' | 'none';
  seed?: number;
  params?: GenParams;
  imagePath?: string;       // when mode === 'image'
  // when mode === 'painted' (brush-edited or baked-from-generated):
  heightPng?: string;       // grayscale PNG data-URL of the heightmap grid
  seaLevel?: number;
  biomePreset?: BiomePreset;
  bakedAssetPath?: string;  // optional raster bake
}

/** A user-imported image registered in the "My Imports" library tab. */
export interface ImportedAsset {
  id: string;
  name: string;
  path: string; // disk path from save_asset (resolved via toAssetUrl at draw time)
}

export interface FantasyMapDoc {
  version: 1;
  kind: MapKind;
  /** Visual engine. Governs terrain render, the auto-applied icon set and chrome. */
  style: MapStyle;
  /** Decorative frame / compass / title banner (used by the hand-drawn style). */
  decor: MapDecor;
  canvas: {
    width: number;
    height: number;
    background: MapBackground;
  };
  grid: MapGrid;
  terrain: TerrainState;
  regions: MapRegion[];
  routes: MapRoute[];
  items: MapItem[];
  labels: MapLabel[];
  /** Custom icons the user imported, available in the library's "My Imports" tab. */
  imports: ImportedAsset[];
  layersMeta: Record<LayerId, { visible: boolean; locked: boolean }>;
}

/* ─────────────────────────────────────────────────────────────────────────
 * Map-kind registry. Adding a future kind (e.g. a Battlemap) is a single entry
 * here plus its default canvas — the template chooser and Map settings read
 * from this list, so nothing else needs rewiring.
 * ───────────────────────────────────────────────────────────────────────── */
export interface MapKindDef {
  id: MapKind;
  title: string;
  blurb: string;
  defaultSize: { width: number; height: number };
  defaultBackground: MapBackground;
}

export const MAP_KINDS: MapKindDef[] = [
  {
    id: 'world',
    title: 'World Map',
    blurb: 'Continents, oceans, biomes & kingdoms. Great for whole-world lore.',
    defaultSize: { width: 1920, height: 1200 },
    defaultBackground: { type: 'parchment', value: '#e9dcc0' },
  },
  {
    id: 'region',
    title: 'Region Map',
    blurb: 'A single realm, province or local area in closer detail.',
    defaultSize: { width: 1400, height: 1000 },
    defaultBackground: { type: 'parchment', value: '#e9dcc0' },
  },
];

export function mapKindDef(kind: MapKind): MapKindDef {
  return MAP_KINDS.find((k) => k.id === kind) ?? MAP_KINDS[0];
}

/* ─────────────────────────────────────────────────────────────────────────
 * Region tiers. Nesting (country → state → county) is modelled as free-form
 * polygons tagged with a level + optional parentId; the level drives the border
 * weight/dash and label size so the hierarchy reads visually. Width/dash are in
 * map units (the renderer divides by the view scale to keep them screen-stable).
 * ───────────────────────────────────────────────────────────────────────── */
export interface RegionLevelDef {
  id: RegionLevel;
  title: string;
  width: number;        // border stroke width
  dash: [number, number];
  labelSize: number;
}

export const REGION_LEVELS: RegionLevelDef[] = [
  { id: 'realm', title: 'Realm / Country', width: 2.6, dash: [10, 8], labelSize: 22 },
  { id: 'province', title: 'Province / State', width: 1.8, dash: [3, 7], labelSize: 17 },
  { id: 'county', title: 'County', width: 1.2, dash: [1.5, 6], labelSize: 13 },
];

export function regionLevelDef(level?: RegionLevel): RegionLevelDef {
  return REGION_LEVELS.find((l) => l.id === level) ?? REGION_LEVELS[0];
}

/** Rank used to draw finer tiers on top (realm 0 → county 2). */
export function regionLevelRank(level?: RegionLevel): number {
  const i = REGION_LEVELS.findIndex((l) => l.id === level);
  return i < 0 ? 0 : i;
}

/** The tier one step below `level` (realm→province→county→county). */
export function childLevel(level?: RegionLevel): RegionLevel {
  const i = REGION_LEVELS.findIndex((l) => l.id === level);
  return REGION_LEVELS[Math.min(REGION_LEVELS.length - 1, (i < 0 ? 0 : i) + 1)].id;
}

export const DEFAULT_GEN_PARAMS: GenParams = {
  style: 'handdrawn',
  shape: 'continent',
  seed: 1,
  landAmount: 0.52,
  roughness: 4,
  biomePreset: 'temperate',
  biomeCount: 6,
  regionCount: 7,
  scatterDensity: 0.5,
  scatterSettlements: true,
  scatterTerrain: true,
};

const ALL_LAYERS: LayerId[] = ['terrain', 'regions', 'routes', 'items', 'labels'];

/** Build a blank document for a freshly created Fantasy Map of `kind`. */
export function createDefaultMapDoc(kind: MapKind = 'world'): FantasyMapDoc {
  const def = mapKindDef(kind);
  const layersMeta = Object.fromEntries(
    ALL_LAYERS.map((l) => [l, { visible: true, locked: false }]),
  ) as FantasyMapDoc['layersMeta'];
  return {
    version: 1,
    kind,
    style: 'handdrawn',
    decor: { frame: true, compass: true, cartouche: true },
    canvas: {
      width: def.defaultSize.width,
      height: def.defaultSize.height,
      background: { ...def.defaultBackground },
    },
    grid: { type: 'none', size: 64, color: '#7c6f57', opacity: 0.25, snap: false },
    terrain: { mode: 'none' },
    regions: [],
    routes: [],
    items: [],
    labels: [],
    imports: [],
    layersMeta,
  };
}

/** Parse `Document.content` into a doc, tolerating empty/legacy/corrupt JSON. */
export function parseMapDoc(content: string, fallbackKind: MapKind = 'world'): FantasyMapDoc {
  try {
    const raw = JSON.parse(content || '{}');
    if (!raw || typeof raw !== 'object' || !raw.version) return createDefaultMapDoc(fallbackKind);
    const base = createDefaultMapDoc(raw.kind === 'region' ? 'region' : 'world');
    return {
      ...base,
      ...raw,
      // Legacy maps (saved before styles existed) were the coloured engine and
      // had no chrome — default them to 'classic' with no frame so they're
      // unchanged; newly-created maps carry their own style/decor.
      style: raw.style === 'handdrawn' || raw.style === 'classic' ? raw.style : 'classic',
      decor: { ...{ frame: false, compass: false, cartouche: false }, ...(raw.decor ?? {}) },
      canvas: { ...base.canvas, ...(raw.canvas ?? {}), background: { ...base.canvas.background, ...(raw.canvas?.background ?? {}) } },
      grid: { ...base.grid, ...(raw.grid ?? {}) },
      terrain: { ...base.terrain, ...(raw.terrain ?? {}) },
      regions: Array.isArray(raw.regions) ? raw.regions : [],
      routes: Array.isArray(raw.routes) ? raw.routes : [],
      items: Array.isArray(raw.items) ? raw.items : [],
      labels: Array.isArray(raw.labels) ? raw.labels : [],
      imports: Array.isArray(raw.imports) ? raw.imports : [],
      layersMeta: { ...base.layersMeta, ...(raw.layersMeta ?? {}) },
    };
  } catch {
    return createDefaultMapDoc(fallbackKind);
  }
}

let _id = 0;
/** Short unique id for map objects (crypto.randomUUID when available). */
export function mapId(prefix = 'm'): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return `${prefix}_${crypto.randomUUID().slice(0, 8)}`;
  return `${prefix}_${Date.now().toString(36)}_${(_id++).toString(36)}`;
}
