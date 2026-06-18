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

/** A named area drawn as a filled polygon. */
export interface MapRegion {
  id: string;
  name: string;
  points: number[];   // flat [x0,y0,x1,y1,…]
  fill: string;
  stroke: string;
  opacity: number;
  z: number;
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
  mode: 'generated' | 'image' | 'none';
  seed?: number;
  params?: GenParams;
  imagePath?: string;       // when mode === 'image'
  bakedAssetPath?: string;  // optional Phase-2 raster bake
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

export const DEFAULT_GEN_PARAMS: GenParams = {
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
