import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { Stage, Layer, Rect, Line, Circle, Image as KonvaImage, Text, Transformer, Shape } from 'react-konva';
import type Konva from 'konva';
import type { KonvaEventObject } from 'konva/lib/Node';
import {
  MousePointer2, Hand, MapPin, Hexagon, Spline, Type as TypeIcon,
  Mountain, Droplets, SprayCan,
  Undo2, Redo2, Wand2, ZoomIn, ZoomOut, Maximize, Save, PanelLeft, PanelRight,
  Copy, Trash2, ArrowUpToLine, ArrowDownToLine, Lock, ClipboardPaste, Image as ImageIcon,
} from 'lucide-react';
import type { Document } from '../types';
import type { ThemeType } from '../App';
import { api } from '../lib/api';
import { toAssetUrl } from '../lib/assets';
import { toItemUrl } from '../lib/mapAssets';
import { isTauri, isMobileOS, useShell } from '../lib/platform';
import type {
  FantasyMapDoc, GenParams, MapItem, MapRegion, MapRoute, MapLabel, MapKind, MapStyle, MapDecor, LayerId,
} from './fantasymap/mapTypes';
import { parseMapDoc, mapId, mapKindDef, DEFAULT_GEN_PARAMS, regionLevelDef, regionLevelRank, childLevel } from './fantasymap/mapTypes';
import { generateMap } from './fantasymap/generator';
import { HeightMap, randomSeed } from './fantasymap/heightmap';
import { iconDataUrl } from './fantasymap/iconLibrary';
import { makeParchment } from './fantasymap/parchment';
import { useImage } from './fantasymap/useImage';
import { useMapHistory } from './fantasymap/useMapHistory';
import LibraryPanel, { type PickedIcon } from './fantasymap/LibraryPanel';
import GeneratePanel from './fantasymap/GeneratePanel';
import InspectorPanel, { type Selection, type SelType } from './fantasymap/InspectorPanel';

interface FantasyMapProps {
  document: Document;
  projectId: string;
  /** Debounced content updates. `docId` lets the parent route a late flush
   *  (e.g. on unmount while switching documents) to the right document. */
  onUpdateContent: (content: string, docId: string) => void;
  onRequestSave: () => void;
  theme: ThemeType;
}

type Tool = 'select' | 'pan' | 'land' | 'sea' | 'stamp' | 'scatter' | 'region' | 'route' | 'label';
const BRUSH_TOOLS: Tool[] = ['land', 'sea', 'scatter'];
const TOOLS: { id: Tool; label: string; Icon: typeof MousePointer2 }[] = [
  { id: 'select', label: 'Select / move (V)', Icon: MousePointer2 },
  { id: 'pan', label: 'Pan (H)', Icon: Hand },
  { id: 'land', label: 'Land brush — paint coastline & terrain (L)', Icon: Mountain },
  { id: 'sea', label: 'Sea brush — carve water (S)', Icon: Droplets },
  { id: 'stamp', label: 'Place one icon (P)', Icon: MapPin },
  { id: 'scatter', label: 'Scatter brush — paint many icons (B)', Icon: SprayCan },
  { id: 'region', label: 'Draw region — freehand, dotted outline (R)', Icon: Hexagon },
  { id: 'route', label: 'Draw road / river (D)', Icon: Spline },
  { id: 'label', label: 'Add label (T)', Icon: TypeIcon },
];
const TOOL_KEYS: Record<string, Tool> = { v: 'select', h: 'pan', l: 'land', s: 'sea', p: 'stamp', b: 'scatter', r: 'region', d: 'route', t: 'label' };

type CtxMenu = { x: number; y: number; sel: Selection | null } | null;
type StageEvt = KonvaEventObject<MouseEvent | TouchEvent>;

/** Pre-rendered ink compass for the hand-drawn decorative chrome. */
const COMPASS_URL = iconDataUrl('ink-compass', '#5b4632');
const SERIF_FONT = "Georgia, 'Iowan Old Style', 'Times New Roman', serif";
const INK = '#4d3a27';

export default function FantasyMap({ document: docProp, projectId, onUpdateContent, onRequestSave }: FantasyMapProps) {
  const { isMobileShell: isMobile } = useShell();

  // Parse once on mount (component is keyed by document id in App, like MindMap).
  const [doc, setDoc] = useState<FantasyMapDoc>(() => parseMapDoc(docProp.content));
  const docRef = useRef(doc);
  useEffect(() => {
    docRef.current = doc;
  }, [doc]);

  const history = useMapHistory();
  const { snapshot } = history;
  const [tool, setTool] = useState<Tool>('select');
  const [picked, setPicked] = useState<PickedIcon | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [draft, setDraft] = useState<{ kind: 'region' | 'route'; points: number[] } | null>(null);
  const draftRef = useRef(draft);
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);
  const [genOpen, setGenOpen] = useState(false);
  const [genParams, setGenParams] = useState<GenParams>({ ...DEFAULT_GEN_PARAMS, seed: randomSeed() });
  const [ctxMenu, setCtxMenu] = useState<CtxMenu>(null);
  const [naming, setNaming] = useState<string | null>(null); // item id being named inline
  const clipboard = useRef<MapItem | null>(null);
  const [hasClipboard, setHasClipboard] = useState(false);
  // Region pen: drawing a boundary by hand (drag or click), closing at the start.
  const penRef = useRef<{ down: boolean; dragged: boolean }>({ down: false, dragged: false });
  // Stroke that grows an existing region (state mirrors the ref for rendering).
  const extendRef = useRef<string | null>(null);
  const [extending, setExtendingState] = useState<string | null>(null);
  const setExtending = (id: string | null) => {
    extendRef.current = id;
    setExtendingState(id);
  };
  const [nearStart, setNearStart] = useState(false);           // cursor near the start dot
  const [penCursor, setPenCursor] = useState<{ x: number; y: number } | null>(null);

  // Brush settings (land/sea/scatter) + live-stroke refs.
  const [brushSize, setBrushSize] = useState(40);
  const [brushStrength, setBrushStrength] = useState(0.7);
  const [seaMode, setSeaMode] = useState<'sea' | 'lake' | 'river'>('sea');
  const [scatterSpacing, setScatterSpacing] = useState(46);
  const paintingRef = useRef<{ raise: boolean; last: { x: number; y: number } } | null>(null);
  const scatterRef = useRef<{ last: { x: number; y: number } } | null>(null);
  // Brush cursor (screen px within the canvas wrap) — drawn as a DOM overlay so
  // moving it never forces a Konva redraw of the map.
  const [brushCursor, setBrushCursor] = useState<{ x: number; y: number } | null>(null);

  // Side panels: docked on desktop, overlays (closed by default) on phones.
  const [leftOpen, setLeftOpen] = useState(!isMobile);
  const [rightOpen, setRightOpen] = useState(!isMobile);
  const [prevMobile, setPrevMobile] = useState(isMobile);
  if (prevMobile !== isMobile) {
    setPrevMobile(isMobile);
    setLeftOpen(!isMobile);
    setRightOpen(!isMobile);
  }

  // ── Mutation + history ────────────────────────────────────────────────
  const mutate = useCallback((fn: (d: FantasyMapDoc) => FantasyMapDoc, snap = true) => {
    if (snap) snapshot(docRef.current);
    setDoc((prev) => fn(prev));
  }, [snapshot]);

  // ── Terrain heightmap (paintable; shared with the generator) ──────────
  const [terrainCanvas, setTerrainCanvas] = useState<HTMLCanvasElement | null>(null);
  const [coastLines, setCoastLines] = useState<number[][] | null>(null);
  const heightRef = useRef<HeightMap | null>(null);
  const renderRaf = useRef(0);
  const renderTerrain = useCallback(() => {
    const hm = heightRef.current;
    if (!hm) { setTerrainCanvas(null); setCoastLines(null); return; }
    setTerrainCanvas(hm.render());
    const c = docRef.current.canvas;
    setCoastLines(hm.style === 'handdrawn' ? hm.coastPolylines(c.width, c.height) : null);
  }, []);
  const scheduleRender = useCallback(() => {
    if (renderRaf.current) return;
    renderRaf.current = requestAnimationFrame(() => { renderRaf.current = 0; renderTerrain(); });
  }, [renderTerrain]);
  // Rebuild the live heightmap from a document's terrain state (mount, undo, redo).
  const syncHeightFromDoc = useCallback((d: FantasyMapDoc) => {
    const t = d.terrain;
    const rug = t.ruggedness ?? t.params?.ruggedness ?? 0;
    if (t.mode === 'generated' && t.params) {
      heightRef.current = HeightMap.fromNoise(t.params, d.canvas.width, d.canvas.height, d.style, rug);
      renderTerrain();
    } else if (t.mode === 'painted' && t.heightPng) {
      HeightMap.fromDataURL(t.heightPng, t.seaLevel ?? 0.4, t.biomePreset ?? 'temperate', d.style, rug)
        .then((hm) => { heightRef.current = hm; renderTerrain(); })
        .catch(() => {});
    } else {
      heightRef.current = null;
      setTerrainCanvas(null);
      setCoastLines(null);
    }
  }, [renderTerrain]);

  const doUndo = useCallback(() => { const p = history.undo(docRef.current); if (p) { setDoc(p); setSelection(null); syncHeightFromDoc(p); } }, [history, syncHeightFromDoc]);
  const doRedo = useCallback(() => { const n = history.redo(docRef.current); if (n) { setDoc(n); setSelection(null); syncHeightFromDoc(n); } }, [history, syncHeightFromDoc]);

  // ── Persist (debounced) after the first render; flushed on unmount/save ──
  const didMount = useRef(false);
  const pendingRef = useRef(false);
  const docId = docProp.id;
  useEffect(() => {
    if (!didMount.current) { didMount.current = true; return; }
    pendingRef.current = true;
    const t = setTimeout(() => { pendingRef.current = false; onUpdateContent(JSON.stringify(doc), docId); }, 400);
    return () => clearTimeout(t);
  }, [doc, docId, onUpdateContent]);
  // A pending update must never be lost when the studio unmounts (document
  // switch, project close): hand the latest state to the parent right away.
  useEffect(() => () => {
    if (pendingRef.current) { pendingRef.current = false; onUpdateContent(JSON.stringify(docRef.current), docId); }
  }, [docId, onUpdateContent]);
  const flushAndSave = () => {
    if (pendingRef.current) { pendingRef.current = false; onUpdateContent(JSON.stringify(docRef.current), docId); }
    onRequestSave();
  };

  // ── Stage sizing ──────────────────────────────────────────────────────
  const wrapRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const layerRef = useRef<Konva.Layer>(null);
  const trRef = useRef<Konva.Transformer>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ── View (pan / zoom) ─────────────────────────────────────────────────
  const [view, setView] = useState({ x: 40, y: 40, scale: 0.5 });
  const W = doc.canvas.width;
  const H = doc.canvas.height;

  const fitToScreen = useCallback(() => {
    const { width: Wd, height: Hd } = docRef.current.canvas;
    const pad = 40;
    const scale = Math.min((size.w - pad * 2) / Wd, (size.h - pad * 2) / Hd);
    const s = Math.max(0.02, Math.min(scale, 4));
    setView({ x: (size.w - Wd * s) / 2, y: (size.h - Hd * s) / 2, scale: s });
  }, [size]);

  // Fit once on first measure.
  const fittedRef = useRef(false);
  useEffect(() => {
    if (!fittedRef.current && size.w > 1) { fittedRef.current = true; fitToScreen(); }
  }, [size, fitToScreen]);

  const zoomBy = (factor: number) => {
    const c = { x: size.w / 2, y: size.h / 2 };
    setView((v) => {
      const s = Math.max(0.05, Math.min(v.scale * factor, 6));
      return { x: c.x - ((c.x - v.x) / v.scale) * s, y: c.y - ((c.y - v.y) / v.scale) * s, scale: s };
    });
  };

  const onWheel = (e: KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const stage = stageRef.current;
    if (!stage) return;
    const pointer = stage.getPointerPosition();
    if (!pointer) return;
    // Trackpad pinch arrives as ctrl+wheel with small deltas; scale the zoom
    // step so both a mouse wheel notch and a pinch feel natural.
    const notch = Math.min(1, Math.abs(e.evt.deltaY) / 100);
    setView((v) => {
      const dir = e.evt.deltaY > 0 ? 1 - 0.12 * notch : 1 + 0.12 * notch;
      const s = Math.max(0.05, Math.min(v.scale * dir, 6));
      return { x: pointer.x - ((pointer.x - v.x) / v.scale) * s, y: pointer.y - ((pointer.y - v.y) / v.scale) * s, scale: s };
    });
  };

  const pointerToMap = (): { x: number; y: number } | null => {
    const stage = stageRef.current;
    const p = stage?.getPointerPosition();
    if (!p) return null;
    return { x: (p.x - view.x) / view.scale, y: (p.y - view.y) / view.scale };
  };

  // Build the terrain raster once on mount (component is keyed by doc id).
  useEffect(() => { syncHeightFromDoc(docRef.current); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const terrainImg = useImage(doc.terrain.mode === 'image' ? toAssetUrl(doc.terrain.imagePath || '') : undefined);

  // Procedural parchment page background (cached per size+colour).
  const parchment = useMemo(
    () => (doc.canvas.background.type === 'parchment' ? makeParchment(W, H, doc.canvas.background.value) : null),
    [doc.canvas.background.type, doc.canvas.background.value, W, H],
  );

  // ── Selection → transformer wiring ────────────────────────────────────
  useEffect(() => {
    const tr = trRef.current;
    const stage = stageRef.current;
    if (!tr || !stage) return;
    if (selection && (selection.type === 'item' || selection.type === 'label')) {
      const node = stage.findOne('#' + selection.id);
      tr.nodes(node ? [node] : []);
    } else {
      tr.nodes([]);
    }
    tr.getLayer()?.batchDraw();
  }, [selection, doc]);

  // ── Object helpers ────────────────────────────────────────────────────
  const nextZ = (arr: { z: number }[]) => (arr.length ? Math.max(...arr.map((o) => o.z)) + 1 : 0);
  const snapPt = (n: number) =>
    doc.grid.snap && doc.grid.type !== 'none' ? Math.round(n / doc.grid.size) * doc.grid.size : n;

  const patchObject = useCallback((type: SelType, id: string, patch: Record<string, unknown>, snapHist = true) => {
    mutate((d) => {
      const key = `${type}s` as 'items' | 'regions' | 'routes' | 'labels';
      return { ...d, [key]: (d[key] as Array<{ id: string }>).map((o) => (o.id === id ? { ...o, ...patch } : o)) } as FantasyMapDoc;
    }, snapHist);
  }, [mutate]);

  const deleteObject = useCallback((type: SelType, id: string) => {
    mutate((d) => {
      const key = `${type}s` as 'items' | 'regions' | 'routes' | 'labels';
      return { ...d, [key]: (d[key] as Array<{ id: string }>).filter((o) => o.id !== id) } as FantasyMapDoc;
    });
    setSelection(null);
    setCtxMenu(null);
  }, [mutate]);

  const reorder = (type: SelType, id: string, toFront: boolean) => {
    mutate((d) => {
      const key = `${type}s` as 'items' | 'regions' | 'routes' | 'labels';
      const arr = d[key] as Array<{ id: string; z: number }>;
      const zs = arr.map((o) => o.z);
      const z = toFront ? Math.max(...zs, 0) + 1 : Math.min(...zs, 0) - 1;
      return { ...d, [key]: arr.map((o) => (o.id === id ? { ...o, z } : o)) } as FantasyMapDoc;
    });
    setCtxMenu(null);
  };

  const copyItem = (id: string) => {
    const it = docRef.current.items.find((i) => i.id === id);
    if (it) { clipboard.current = it; setHasClipboard(true); }
    setCtxMenu(null);
  };

  // ── Stamp / draw / label placement ────────────────────────────────────
  const stampAt = (mx: number, my: number) => {
    if (!picked) return;
    const item: MapItem = {
      id: mapId('it'), libId: picked.libId, assetPath: picked.assetPath,
      x: snapPt(mx), y: snapPt(my), width: picked.size, height: picked.size,
      scale: 1, rotation: 0, z: nextZ(doc.items), tint: picked.libId ? '#3a2f23' : undefined,
    };
    mutate((d) => ({ ...d, items: [...d.items, item] }));
    setSelection({ type: 'item', id: item.id });
  };

  // Inline naming: double-click an asset to type a name that shows beneath it.
  const startNaming = (id: string) => {
    snapshot(docRef.current);
    setSelection({ type: 'item', id });
    setNaming(id);
  };

  const addLabel = (mx: number, my: number) => {
    const color = docRef.current.style === 'handdrawn' ? '#9e2b25' : '#3a2f23';
    const label: MapLabel = { id: mapId('lb'), text: 'New label', x: mx, y: my, size: 22, color, rotation: 0, bold: true };
    mutate((d) => ({ ...d, labels: [...d.labels, label] }));
    setSelection({ type: 'label', id: label.id });
    setTool('select');
  };

  const commitDraft = () => {
    const d = draftRef.current;
    if (!d) return;
    if (d.kind === 'region' && d.points.length >= 6) {
      const region: MapRegion = {
        id: mapId('reg'), name: 'New region', points: d.points,
        fill: '#5aa05a', stroke: '#3a2f23', opacity: 0.3, z: nextZ(doc.regions),
        labelPos: { x: avg(d.points, 0), y: avg(d.points, 1) },
      };
      mutate((dd) => ({ ...dd, regions: [...dd.regions, region] }));
      setSelection({ type: 'region', id: region.id });
    } else if (d.kind === 'route' && d.points.length >= 4) {
      const ink = docRef.current.style === 'handdrawn';
      const route: MapRoute = {
        id: mapId('rt'), kind: 'road', points: d.points, color: ink ? '#6b4f2a' : '#6b4f2a', width: 4, z: nextZ(doc.routes),
        dashed: ink,
      };
      mutate((dd) => ({ ...dd, routes: [...dd.routes, route] }));
      setSelection({ type: 'route', id: route.id });
    }
    setDraft(null);
    setTool('select');
  };

  // ── Brush painting (land/sea heightmap + icon scatter) ────────────────
  // Sea-brush feature presets: how deep the carve is (and how thin the river).
  const SEA_DEPTH = { sea: 0.34, lake: 0.16, river: 0.12 };
  const ensureHeight = () => {
    if (!heightRef.current) {
      heightRef.current = HeightMap.blank(W, H, genParams.biomePreset, 0.4, docRef.current.style, docRef.current.terrain.ruggedness ?? genParams.ruggedness);
    }
    return heightRef.current;
  };
  const paintAt = (mx: number, my: number, raise: boolean) => {
    const hm = ensureHeight();
    const depth = raise ? 0.4 : SEA_DEPTH[seaMode];
    const radius = !raise && seaMode === 'river' ? brushSize * 0.5 : brushSize;
    hm.paint(mx, my, radius, brushStrength, raise, W, H, depth);
    scheduleRender();
  };
  // Lake feature: one click drops a contained, shallow pond (several strong
  // passes so the whole footprint reliably crosses below sea level at once).
  const stampLake = (mx: number, my: number) => {
    const hm = ensureHeight();
    for (let k = 0; k < 4; k++) hm.paint(mx, my, brushSize, 1, false, W, H, SEA_DEPTH.lake);
    scheduleRender();
  };
  const commitTerrainPaint = () => {
    const hm = heightRef.current;
    if (!hm) return;
    // History was snapshotted at stroke start; persist without a second snapshot.
    mutate((d) => ({
      ...d,
      terrain: { mode: 'painted', heightPng: hm.toDataURL(), seaLevel: hm.seaLevel, biomePreset: hm.preset, ruggedness: hm.ruggedness },
    }), false);
  };
  const scatterStamp = (mx: number, my: number) => {
    if (!picked) return;
    const jx = mx + (Math.random() - 0.5) * brushSize * 0.7;
    const jy = my + (Math.random() - 0.5) * brushSize * 0.7;
    const item: MapItem = {
      id: mapId('it'), libId: picked.libId, assetPath: picked.assetPath,
      x: jx, y: jy, width: picked.size, height: picked.size,
      scale: 0.7 + Math.random() * 0.7, rotation: 0, z: nextZ(docRef.current.items),
      tint: picked.libId ? '#3a2f23' : undefined,
    };
    mutate((d) => ({ ...d, items: [...d.items, item] }), false);
  };

  // Close the in-progress boundary into a region (border-only, auto-parented).
  const closeNewRegion = () => {
    const d = draftRef.current;
    penRef.current = { down: false, dragged: false };
    setNearStart(false);
    if (!d || d.points.length < 6) { setDraft(null); return; }
    const ink = docRef.current.style === 'handdrawn';
    const cx = avg(d.points, 0), cy = avg(d.points, 1);
    // Auto-parent: smallest existing region whose polygon contains the centroid.
    const parent = smallestContainer(docRef.current.regions, cx, cy);
    const region: MapRegion = {
      id: mapId('reg'), name: 'New region', points: d.points,
      fill: ink ? '#b98e52' : '#5aa05a', stroke: ink ? '#7c5c34' : '#3a2f23',
      opacity: 0.16, showFill: false,
      level: parent ? childLevel(parent.level) : 'realm', parentId: parent?.id,
      z: nextZ(docRef.current.regions),
      labelPos: { x: cx, y: cy },
    };
    // History was snapshotted when the stroke began.
    mutate((dd) => ({ ...dd, regions: [...dd.regions, region] }), false);
    setDraft(null);
    setSelection({ type: 'region', id: region.id });
    setTool('select');
  };

  // Grow the selected region by splicing the drawn arc into its boundary.
  const commitExtend = () => {
    const regionId = extendRef.current;
    const arc = draftRef.current?.points ?? [];
    setExtending(null);
    penRef.current = { down: false, dragged: false };
    setDraft(null);
    setNearStart(false);
    if (!regionId || arc.length < 6) return;
    const reg = docRef.current.regions.find((r) => r.id === regionId);
    if (!reg) return;
    const grown = extendRegion(reg.points, arc);
    if (grown && grown.length >= 6) patchObject('region', reg.id, { points: grown }, false);
  };

  const endStroke = () => {
    if (penRef.current.down || extendRef.current) {
      penRef.current.down = false;
      if (extendRef.current) commitExtend(); // new boundaries stay open until closed at the start
    }
    if (paintingRef.current) { paintingRef.current = null; commitTerrainPaint(); }
    scatterRef.current = null;
  };

  const cancelDraft = () => {
    setDraft(null);
    penRef.current = { down: false, dragged: false };
    setExtending(null);
    setNearStart(false);
    setPenCursor(null);
  };

  const selectTool = (id: Tool) => {
    setTool(id);
    if (id !== 'stamp' && id !== 'scatter') setPicked(null);
    if (id !== 'region' && id !== 'route') setDraft(null);
    if (id !== 'region') { penRef.current = { down: false, dragged: false }; setExtending(null); setNearStart(false); setPenCursor(null); }
  };

  // ── Keyboard ──────────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = window.document.activeElement as HTMLElement | null;
      const tag = el?.tagName.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || el?.isContentEditable) return;
      const mod = e.ctrlKey || e.metaKey;
      const regionDraft = draft?.kind === 'region' && !extendRef.current;
      if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); doUndo(); }
      else if (mod && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) { e.preventDefault(); doRedo(); }
      else if (mod && e.key.toLowerCase() === 'c' && selection?.type === 'item') { e.preventDefault(); copyItem(selection.id); }
      else if (mod && e.key.toLowerCase() === 'v' && clipboard.current) {
        e.preventDefault();
        const src = clipboard.current;
        const n: MapItem = { ...src, id: mapId('it'), x: src.x + 24, y: src.y + 24, z: nextZ(docRef.current.items) };
        mutate((d) => ({ ...d, items: [...d.items, n] }));
        setSelection({ type: 'item', id: n.id });
      }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && regionDraft) {
        // Remove the last placed vertex while drawing a boundary.
        e.preventDefault();
        setDraft((d) => (d && d.points.length > 2 ? { ...d, points: d.points.slice(0, -2) } : d));
      }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && selection) { e.preventDefault(); deleteObject(selection.type, selection.id); }
      else if (e.key === 'Escape') { cancelDraft(); setSelection(null); setPicked(null); setCtxMenu(null); setNaming(null); setGenOpen(false); }
      else if (e.key === 'Enter' && regionDraft) { e.preventDefault(); closeNewRegion(); }
      else if (e.key === 'Enter' && draft) { e.preventDefault(); commitDraft(); }
      else if (!mod && !e.altKey && TOOL_KEYS[e.key.toLowerCase()]) { selectTool(TOOL_KEYS[e.key.toLowerCase()]); }
      else if (e.key === '0' && mod) { e.preventDefault(); fitToScreen(); }
      else if ((e.key === '=' || e.key === '+') && mod) { e.preventDefault(); zoomBy(1.2); }
      else if (e.key === '-' && mod) { e.preventDefault(); zoomBy(0.8); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // ── Stage events ──────────────────────────────────────────────────────
  const onStageMouseDown = (e: StageEvt) => {
    setCtxMenu(null);
    const bg = e.target.name() === 'bg' || e.target === stageRef.current;
    const m = pointerToMap();
    if (!m) return;

    if (tool === 'land' || tool === 'sea') {
      snapshot(docRef.current);
      paintingRef.current = { raise: tool === 'land', last: m };
      if (tool === 'sea' && seaMode === 'lake') stampLake(m.x, m.y);
      else paintAt(m.x, m.y, tool === 'land');
      return;
    }
    if (tool === 'scatter' && picked) {
      snapshot(docRef.current);
      scatterRef.current = { last: m };
      scatterStamp(m.x, m.y);
      return;
    }
    if (tool === 'stamp' && picked) { stampAt(m.x, m.y); return; }
    if (tool === 'label') { addLabel(m.x, m.y); return; }
    if (tool === 'region') {
      const snapR = 12 / view.scale;
      // Extend: if a region is selected and we press near its boundary, this
      // stroke grows that region instead of starting a new one.
      if (!draft && selection?.type === 'region') {
        const reg = docRef.current.regions.find((r) => r.id === selection.id);
        if (reg && !reg.locked && distToRing(reg.points, m.x, m.y) <= 18 / view.scale) {
          snapshot(docRef.current);
          setExtending(reg.id);
          penRef.current = { down: true, dragged: false };
          setDraft({ kind: 'region', points: [m.x, m.y] });
          return;
        }
      }
      if (!draft) {
        // Start a new boundary.
        snapshot(docRef.current);
        penRef.current = { down: true, dragged: false };
        setNearStart(false);
        setDraft({ kind: 'region', points: [m.x, m.y] });
        return;
      }
      // Active boundary: close if we clicked the start dot, else drop a vertex.
      const sx = draft.points[0], sy = draft.points[1];
      if (draft.points.length >= 6 && Math.hypot(m.x - sx, m.y - sy) <= snapR) { closeNewRegion(); return; }
      penRef.current = { down: true, dragged: false };
      setDraft((d) => (d ? { ...d, points: [...d.points, m.x, m.y] } : d));
      return;
    }
    if (tool === 'route') {
      // Roads/rivers stay click-to-add-point (precise polylines).
      setDraft((dr) => {
        if (!dr || dr.kind !== 'route') return { kind: 'route', points: [m.x, m.y] };
        return { kind: 'route', points: [...dr.points, m.x, m.y] };
      });
      return;
    }
    if (tool === 'select' && bg) setSelection(null);
  };

  const onStageMouseMove = () => {
    if (tool === 'region') {
      const m = pointerToMap();
      if (!m) return;
      if (draft) setPenCursor(m);
      if (penRef.current.down) {
        // Drag = freehand append (works for a new boundary and for an extend arc).
        const step = 8 / view.scale;
        setDraft((d) => {
          if (!d) return d;
          const n = d.points.length;
          const lx = d.points[n - 2], ly = d.points[n - 1];
          if (Math.hypot(m.x - lx, m.y - ly) >= step) { penRef.current.dragged = true; return { ...d, points: [...d.points, m.x, m.y] }; }
          return d;
        });
        // Auto-close a new boundary if dragged back onto the start dot.
        if (!extendRef.current && draft && draft.points.length >= 8) {
          const sx = draft.points[0], sy = draft.points[1];
          if (Math.hypot(m.x - sx, m.y - sy) <= 12 / view.scale) closeNewRegion();
        }
      } else if (draft && !extendRef.current) {
        const sx = draft.points[0], sy = draft.points[1];
        setNearStart(draft.points.length >= 6 && Math.hypot(m.x - sx, m.y - sy) <= 12 / view.scale);
      }
      return;
    }
    if (!paintingRef.current && !scatterRef.current) return;
    const m = pointerToMap();
    if (!m) return;
    if (paintingRef.current) {
      // Interpolate along the stroke so fast drags leave a continuous line
      // (essential for thin rivers) instead of dotted dabs.
      const last = paintingRef.current.last;
      const dx = m.x - last.x, dy = m.y - last.y;
      const dist = Math.hypot(dx, dy);
      const stepPx = Math.max(2, brushSize * 0.5);
      const n = Math.max(1, Math.round(dist / stepPx));
      for (let k = 1; k <= n; k++) paintAt(last.x + (dx * k) / n, last.y + (dy * k) / n, paintingRef.current.raise);
      paintingRef.current.last = m;
      return;
    }
    if (scatterRef.current) {
      const last = scatterRef.current.last;
      if (Math.hypot(m.x - last.x, m.y - last.y) >= scatterSpacing) {
        scatterStamp(m.x, m.y);
        scatterRef.current.last = m;
      }
    }
  };

  // ── Touch: one finger draws/paints/selects; two fingers pinch-zoom + pan ──
  const pinchRef = useRef<{ dist: number; center: { x: number; y: number } | null }>({ dist: 0, center: null });

  const touchPoints = (touches: TouchList) => {
    const rect = stageRef.current?.container().getBoundingClientRect();
    if (!rect) return null;
    return Array.from(touches).map((t) => ({ x: t.clientX - rect.left, y: t.clientY - rect.top }));
  };

  const onStageTouchStart = (e: KonvaEventObject<TouchEvent>) => {
    if (e.evt.touches.length >= 2) {
      e.evt.preventDefault();
      // A second finger turns a stroke into a pinch: finish whatever was in
      // progress so nothing is half-applied.
      endStroke();
      pinchRef.current = { dist: 0, center: null };
      return;
    }
    // Single finger behaves exactly like a mouse press (Konva does not
    // synthesise mouse events from touch, and `tap` only fires on release —
    // which is why brush strokes never started on phones before).
    if (tool !== 'pan') e.evt.preventDefault();
    onStageMouseDown(e);
  };

  const onStageTouchMove = (e: KonvaEventObject<TouchEvent>) => {
    const touches = e.evt.touches;
    if (touches.length >= 2) {
      e.evt.preventDefault();
      const pts = touchPoints(touches);
      if (!pts) return;
      const [p1, p2] = pts;
      const dist = Math.hypot(p1.x - p2.x, p1.y - p2.y);
      const center = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
      const prev = pinchRef.current;
      if (!prev.center || prev.dist === 0) {
        pinchRef.current = { dist, center };
        return;
      }
      setView((v) => {
        const s = Math.max(0.05, Math.min(v.scale * (dist / prev.dist), 6));
        const pointTo = { x: (center.x - v.x) / v.scale, y: (center.y - v.y) / v.scale };
        return { x: center.x - pointTo.x * s, y: center.y - pointTo.y * s, scale: s };
      });
      pinchRef.current = { dist, center };
      return;
    }
    if (tool !== 'pan' && tool !== 'select') e.evt.preventDefault();
    onStageMouseMove();
  };

  const onStageTouchEnd = (e: KonvaEventObject<TouchEvent>) => {
    if (pinchRef.current.center) {
      if (e.evt.touches.length < 2) pinchRef.current = { dist: 0, center: null };
      return;
    }
    endStroke();
  };

  // Brush cursor overlay: track the pointer over the canvas wrap (DOM, not Konva).
  const onWrapPointerMove = (e: ReactPointerEvent) => {
    if (e.pointerType === 'touch') return;
    if (!BRUSH_TOOLS.includes(tool)) { if (brushCursor) setBrushCursor(null); return; }
    const r = wrapRef.current?.getBoundingClientRect();
    if (!r) return;
    setBrushCursor({ x: e.clientX - r.left, y: e.clientY - r.top });
  };
  const onWrapPointerLeave = () => setBrushCursor(null);

  // End brush strokes even if the pointer is released outside the canvas.
  useEffect(() => {
    const up = () => endStroke();
    window.addEventListener('pointerup', up);
    return () => window.removeEventListener('pointerup', up);
  });

  const onStageDblClick = () => {
    if (draft?.kind === 'region' && !extendRef.current) closeNewRegion();
    else if (draft) commitDraft();
  };

  const onStageContextMenu = (e: KonvaEventObject<PointerEvent>) => {
    e.evt.preventDefault();
    setCtxMenu({ x: e.evt.clientX, y: e.evt.clientY, sel: selection });
  };

  const layerDraggable = tool === 'pan' || tool === 'select';

  // ── Generate ──────────────────────────────────────────────────────────
  const runGenerate = (params: GenParams) => {
    const { hm, regions, items } = generateMap(params, W, H);
    heightRef.current = hm;
    renderTerrain();
    mutate((d) => ({
      ...d,
      style: params.style,
      decor: params.style === 'handdrawn' ? { frame: true, compass: true, cartouche: true } : d.decor,
      terrain: { mode: 'generated', seed: params.seed, params, ruggedness: params.ruggedness },
      regions,
      items,
    }));
    setSelection(null);
    requestAnimationFrame(fitToScreen);
  };
  const onGenerate = () => runGenerate(genParams);
  const onRegenerate = () => { const p = { ...genParams, seed: randomSeed() }; setGenParams(p); runGenerate(p); };
  const onRandomize = () => {
    const r = () => Math.random();
    const shapes: GenParams['shape'][] = ['island', 'continent', 'archipelago'];
    const presets: GenParams['biomePreset'][] = ['temperate', 'arid', 'arctic', 'volcanic', 'verdant'];
    const p: GenParams = {
      style: genParams.style, // keep the chosen engine; randomise the world only
      shape: shapes[Math.floor(r() * shapes.length)],
      seed: randomSeed(),
      landAmount: 0.35 + r() * 0.45,
      roughness: 2 + Math.floor(r() * 5),
      ruggedness: 0.15 + r() * 0.7,
      biomePreset: presets[Math.floor(r() * presets.length)],
      biomeCount: 3 + Math.floor(r() * 7),
      regionCount: 3 + Math.floor(r() * 18),
      scatterDensity: 0.3 + r() * 0.6,
      scatterSettlements: true,
      scatterTerrain: true,
    };
    setGenParams(p);
    runGenerate(p);
  };
  const onClearGen = () => {
    heightRef.current = null;
    setTerrainCanvas(null);
    setCoastLines(null);
    mutate((d) => ({ ...d, terrain: { mode: 'none' }, regions: [], items: [] }));
    setSelection(null);
  };

  // ── Import ────────────────────────────────────────────────────────────
  const importIcons = async () => {
    try {
      const paths = await api.importAssets(projectId);
      if (!paths.length) return;
      mutate((d) => ({
        ...d,
        imports: [...d.imports, ...paths.map((p) => ({ id: mapId('imp'), name: fileName(p), path: p }))],
      }));
    } catch (e) {
      console.error('[map] icon import failed', e);
    }
  };
  const importBackground = async () => {
    try {
      const paths = await api.importAssets(projectId);
      if (!paths.length) return;
      mutate((d) => ({ ...d, terrain: { mode: 'image', imagePath: paths[0] } }));
    } catch (e) {
      console.error('[map] background import failed', e);
    }
  };

  // ── Export PNG ────────────────────────────────────────────────────────
  const [exportNote, setExportNote] = useState<string | null>(null);
  const exportPng = () => {
    const stage = stageRef.current;
    const layer = layerRef.current;
    if (!stage || !layer) return;
    setSelection(null);
    setCtxMenu(null);
    // Wait a frame so the selection handles are gone, then render the page
    // off-screen at the current zoom (screen-space strokes stay consistent)
    // without touching the visible view — no flash.
    requestAnimationFrame(async () => {
      const s = view.scale;
      const targetW = Math.min(2 * W, 4096);
      const ratio = targetW / (W * s);
      trRef.current?.hide();
      layer.position({ x: 0, y: 0 });
      layer.scale({ x: s, y: s });
      let url = '';
      try {
        url = stage.toDataURL({ x: 0, y: 0, width: W * s, height: H * s, pixelRatio: ratio, mimeType: 'image/png' });
      } finally {
        layer.position({ x: view.x, y: view.y });
        layer.scale({ x: s, y: s });
        trRef.current?.show();
        layer.batchDraw();
      }
      if (!url) return;
      const name = `${(docProp.title || 'map').replace(/[\\/:*?"<>|]+/g, '_')}.png`;
      try {
        const saved = await savePng(url, name, projectId);
        setExportNote(saved ? `Saved ${saved}` : null);
        if (saved) window.setTimeout(() => setExportNote(null), 4000);
      } catch (e) {
        console.error('[map] export failed', e);
        setExportNote('Export failed');
        window.setTimeout(() => setExportNote(null), 4000);
      }
    });
  };

  // ── Layer settings ────────────────────────────────────────────────────
  const onToggleLayer = (layer: LayerId, key: 'visible' | 'locked') =>
    mutate((d) => ({ ...d, layersMeta: { ...d.layersMeta, [layer]: { ...d.layersMeta[layer], [key]: !d.layersMeta[layer][key] } } }), false);
  const onChangeKind = (kind: MapKind) => mutate((d) => ({ ...d, kind }));
  const onChangeStyle = (style: MapStyle) => {
    mutate((d) => ({
      ...d,
      style,
      // turn the decorative chrome on for hand-drawn, off for the classic look
      decor: style === 'handdrawn'
        ? { frame: true, compass: true, cartouche: true }
        : { frame: false, compass: false, cartouche: false },
    }));
    setGenParams((p) => ({ ...p, style }));
    if (heightRef.current) { heightRef.current.style = style; renderTerrain(); }
  };
  const onToggleDecor = (key: keyof MapDecor) =>
    mutate((d) => ({ ...d, decor: { ...d.decor, [key]: !d.decor[key] } }), false);
  // Live ruggedness: warp the existing terrain (generated or painted) on the fly.
  const onSetRuggedness = (v: number) => {
    mutate((d) => ({ ...d, terrain: { ...d.terrain, ruggedness: v } }), false);
    if (heightRef.current) { heightRef.current.ruggedness = v; scheduleRender(); }
  };
  const onPatchCanvas = (patch: Partial<FantasyMapDoc['canvas']>) => mutate((d) => ({ ...d, canvas: { ...d.canvas, ...patch } }), false);
  const onPatchBackground = (patch: Partial<FantasyMapDoc['canvas']['background']>) =>
    mutate((d) => ({ ...d, canvas: { ...d.canvas, background: { ...d.canvas.background, ...patch } } }), false);
  const onPatchGrid = (patch: Partial<FantasyMapDoc['grid']>) => mutate((d) => ({ ...d, grid: { ...d.grid, ...patch } }), false);

  // Resize the canvas (e.g. up to 4K) and scale all content proportionally so
  // nothing shifts. Terrain re-derives at the new resolution on the next sync.
  const onResizeCanvas = (w: number, h: number) => {
    const d0 = docRef.current;
    if (w === d0.canvas.width && h === d0.canvas.height) return;
    const sx = w / d0.canvas.width, sy = h / d0.canvas.height, s = (sx + sy) / 2;
    const sp = (pts: number[]) => pts.map((v, i) => (i % 2 ? v * sy : v * sx));
    mutate((d) => ({
      ...d,
      canvas: { ...d.canvas, width: w, height: h },
      items: d.items.map((it) => ({ ...it, x: it.x * sx, y: it.y * sy, scale: it.scale * s })),
      regions: d.regions.map((r) => ({ ...r, points: sp(r.points), labelPos: r.labelPos ? { x: r.labelPos.x * sx, y: r.labelPos.y * sy } : undefined })),
      routes: d.routes.map((r) => ({ ...r, points: sp(r.points), width: Math.max(1, Math.round(r.width * s)) })),
      labels: d.labels.map((l) => ({ ...l, x: l.x * sx, y: l.y * sy, size: Math.max(8, Math.round(l.size * s)) })),
    }));
    setSelection(null);
    requestAnimationFrame(() => { syncHeightFromDoc(docRef.current); fitToScreen(); });
  };

  // ── Drag start (one history snapshot per gesture) ─────────────────────
  const onObjDragStart = () => snapshot(docRef.current);

  // ── Sorted draws (respect z) ──────────────────────────────────────────
  // Draw finer tiers on top: realm → province → county, then by z within a tier.
  const sortedRegions = useMemo(
    () => [...doc.regions].sort((a, b) => (regionLevelRank(a.level) - regionLevelRank(b.level)) || (a.z - b.z)),
    [doc.regions],
  );
  const sortedRoutes = useMemo(() => [...doc.routes].sort((a, b) => a.z - b.z), [doc.routes]);
  const sortedItems = useMemo(() => [...doc.items].sort((a, b) => a.z - b.z), [doc.items]);
  const lm = doc.layersMeta;

  const selectable = tool === 'select';
  const kindDef = mapKindDef(doc.kind);
  // The item currently being named inline (double-click), if any.
  const namingItem = naming ? doc.items.find((i) => i.id === naming) : undefined;
  // The region whose vertex handles are shown (selected + editable).
  const editableRegion =
    selection?.type === 'region' && selectable && !lm.regions.locked
      ? doc.regions.find((r) => r.id === selection.id && !r.locked)
      : undefined;

  // Hand-drawn styling for captions/labels + the decorative compass image.
  const isInk = doc.style === 'handdrawn';
  const labelFill = isInk ? '#9e2b25' : '#2b2317';
  const labelFont = isInk ? SERIF_FONT : 'Inter, system-ui, sans-serif';
  const compassImg = useImage(isInk && doc.decor.compass ? COMPASS_URL : undefined);
  // Paper colour fills each ink icon's occlusion silhouette so overlapping
  // assets hide each other instead of showing through; it also backs the
  // text halos that keep labels legible over busy terrain.
  const paperColor = doc.canvas.background.value || '#e9dcc0';
  const halo = doc.canvas.background.type === 'color' ? paperColor : isInk ? '#efe4c8' : '#f4efe4';

  const panelOverlay = isMobile;
  const panelCls = (side: 'left' | 'right') =>
    panelOverlay
      ? `absolute z-40 ${side}-0 top-0 bottom-0 w-[min(18rem,86vw)] shadow-2xl animate-in ${side === 'left' ? 'slide-in-from-left' : 'slide-in-from-right'} duration-200`
      : `w-60 shrink-0 ${side === 'left' ? 'border-r' : 'border-l'} border-border/30`;

  return (
    <div className="flex-1 flex flex-col bg-background overflow-hidden relative min-h-0">
      {/* Toolbar */}
      <div className={`min-h-10 bg-secondary/20 border-b border-border/30 flex items-center gap-x-3 gap-y-1 px-3 py-1 select-none ${
        isMobile ? 'overflow-x-auto flex-nowrap' : 'flex-wrap'
      }`}>
        <div className="flex items-center gap-0.5 shrink-0">
          {TOOLS.map(({ id, label, Icon }) => (
            <button key={id} title={label} onClick={() => selectTool(id)} className={`fm-tool ${tool === id ? 'is-active' : ''}`}>
              <Icon className="w-4 h-4" />
            </button>
          ))}
        </div>

        <div className="flex items-center gap-0.5 pl-2 border-l border-border/30 shrink-0">
          <button onClick={doUndo} disabled={!history.canUndo} className="fm-iconbtn" title="Undo (Ctrl+Z)"><Undo2 className="w-4 h-4" /></button>
          <button onClick={doRedo} disabled={!history.canRedo} className="fm-iconbtn" title="Redo (Ctrl+Y)"><Redo2 className="w-4 h-4" /></button>
        </div>

        <div className="relative pl-2 border-l border-border/30 shrink-0">
          <button onClick={() => setGenOpen((o) => !o)} className={`fm-btn fm-btn-primary ${genOpen ? 'is-active' : ''}`} title="Auto-generate a world">
            <Wand2 className="w-3.5 h-3.5" /> Generate
          </button>
          {genOpen && (
            <div className={isMobile ? 'fixed inset-x-2 top-14 z-[60]' : 'absolute left-0 top-full mt-1.5 z-[60]'}>
              <GeneratePanel
                params={genParams} onChange={setGenParams}
                onGenerate={() => { onGenerate(); if (isMobile) setGenOpen(false); }}
                onRegenerate={onRegenerate} onRandomize={onRandomize} onClear={onClearGen}
                onClose={() => setGenOpen(false)}
              />
            </div>
          )}
        </div>

        <div className="flex items-center gap-0.5 pl-2 border-l border-border/30 shrink-0">
          <button onClick={() => zoomBy(1.2)} className="fm-iconbtn" title="Zoom in (Ctrl +)"><ZoomIn className="w-4 h-4" /></button>
          <button onClick={() => zoomBy(0.8)} className="fm-iconbtn" title="Zoom out (Ctrl −)"><ZoomOut className="w-4 h-4" /></button>
          <button onClick={fitToScreen} className="fm-iconbtn" title="Fit to screen (Ctrl 0)"><Maximize className="w-4 h-4" /></button>
          <span className="text-[11px] text-muted-foreground/70 tabular-nums w-10 text-center">{Math.round(view.scale * 100)}%</span>
        </div>

        <div className="ml-auto flex items-center gap-1 shrink-0">
          <button onClick={() => { setLeftOpen((o) => !o); if (isMobile) setRightOpen(false); }} className={`fm-iconbtn ${leftOpen ? 'text-primary' : ''}`} title="Toggle library"><PanelLeft className="w-4 h-4" /></button>
          <button onClick={() => { setRightOpen((o) => !o); if (isMobile) setLeftOpen(false); }} className={`fm-iconbtn ${rightOpen ? 'text-primary' : ''}`} title="Toggle inspector"><PanelRight className="w-4 h-4" /></button>
          <button onClick={flushAndSave} className="fm-btn fm-btn-primary" title="Save map (Ctrl+S)"><Save className="w-3.5 h-3.5" /> Save</button>
        </div>
      </div>

      {draft && (
        <div className="absolute top-12 left-1/2 -translate-x-1/2 z-30 bg-popover border border-border/50 rounded-full px-3 py-1 text-xs shadow-lg flex items-center gap-2 max-w-[94vw]">
          {draft.kind === 'route' ? (
            <>
              <span className="truncate">Click to add points · double-click or Enter to finish · Esc to cancel</span>
              <button className="fm-btn fm-btn-sm" onClick={commitDraft}>Finish</button>
            </>
          ) : extending ? (
            <span className="truncate">Extending — release back on the region’s edge to grow it · Esc to cancel</span>
          ) : (
            <span className="truncate">Drawing region — click or drag the border, return to the <b>start dot</b> (or Enter) to close · Backspace undoes · Esc cancels</span>
          )}
        </div>
      )}

      {exportNote && (
        <div className="absolute top-12 left-1/2 -translate-x-1/2 z-30 bg-popover border border-border/50 rounded-full px-3 py-1 text-xs shadow-lg max-w-[94vw] truncate">
          {exportNote}
        </div>
      )}

      {/* Brush options */}
      {BRUSH_TOOLS.includes(tool) && (
        <div className="fm-brushbar">
          <span className="text-[11px] font-semibold flex items-center gap-1.5">
            {tool === 'land' ? <><Mountain className="w-3.5 h-3.5" /> Land brush</>
              : tool === 'sea' ? <><Droplets className="w-3.5 h-3.5" /> Sea brush</>
              : <><SprayCan className="w-3.5 h-3.5" /> Scatter brush</>}
          </span>
          <label className="flex items-center gap-1.5">
            <span className="text-[10px] text-muted-foreground">Size</span>
            <input type="range" className="fm-range w-24" min={4} max={280} step={2}
              value={brushSize} onChange={(e) => setBrushSize(Number(e.target.value))} />
            <span className="text-[10px] text-muted-foreground/70 tabular-nums w-7">{brushSize}</span>
          </label>
          {(tool === 'land' || tool === 'sea') && (
            <label className="flex items-center gap-1.5">
              <span className="text-[10px] text-muted-foreground">Strength</span>
              <input type="range" className="fm-range w-20" min={0.1} max={1} step={0.05}
                value={brushStrength} onChange={(e) => setBrushStrength(Number(e.target.value))} />
            </label>
          )}
          {tool === 'sea' && (
            <div className="flex items-center gap-0.5">
              {(['sea', 'lake', 'river'] as const).map((mz) => (
                <button key={mz} onClick={() => setSeaMode(mz)}
                  className={`fm-seg ${seaMode === mz ? 'is-active' : ''}`} style={{ flex: 'none', minWidth: '2.7rem' }}>
                  {mz === 'sea' ? 'Sea' : mz === 'lake' ? 'Lake' : 'River'}
                </button>
              ))}
            </div>
          )}
          {tool === 'scatter' && (
            <>
              <label className="flex items-center gap-1.5">
                <span className="text-[10px] text-muted-foreground">Spacing</span>
                <input type="range" className="fm-range w-20" min={16} max={140} step={2}
                  value={scatterSpacing} onChange={(e) => setScatterSpacing(Number(e.target.value))} />
              </label>
              <span className="text-[10px] text-muted-foreground">
                {picked ? <>Painting <b className="text-foreground">{picked.label}</b></> : 'Pick an icon from the library'}
              </span>
            </>
          )}
          {(tool === 'land' || tool === 'sea') && (
            <span className="text-[10px] text-muted-foreground/70 hidden md:inline">
              {tool === 'land' ? 'Drag to paint land'
                : seaMode === 'lake' ? 'Click to drop a lake · drag to enlarge'
                : seaMode === 'river' ? 'Drag to carve a river'
                : 'Drag to carve ocean'}
            </span>
          )}
        </div>
      )}

      {/* Body */}
      <div className="flex-1 min-h-0 flex relative">
        {/* Phone: a tap outside a floating panel closes it */}
        {panelOverlay && (leftOpen || rightOpen) && (
          <div className="absolute inset-0 z-30 bg-background/40" onClick={() => { setLeftOpen(false); setRightOpen(false); }} />
        )}

        {/* Left library */}
        {leftOpen && (
          <div className={panelCls('left')}>
            <LibraryPanel
              active={picked} imports={doc.imports}
              onPick={(p) => {
                setPicked(p);
                if (p) { if (tool !== 'scatter') setTool('stamp'); if (panelOverlay) setLeftOpen(false); }
                else if (tool === 'stamp' || tool === 'scatter') setTool('select');
              }}
              onImport={importIcons} onImportBackground={importBackground}
            />
          </div>
        )}

        {/* Canvas */}
        <div ref={wrapRef} className="flex-1 min-h-0 relative fm-canvas-wrap touch-none" onContextMenu={(e) => e.preventDefault()}
          onPointerMove={onWrapPointerMove} onPointerLeave={onWrapPointerLeave}>
          <Stage
            ref={stageRef}
            width={size.w}
            height={size.h}
            onWheel={onWheel}
            onMouseDown={onStageMouseDown}
            onTouchStart={onStageTouchStart}
            onMouseMove={onStageMouseMove}
            onTouchMove={onStageTouchMove}
            onMouseUp={endStroke}
            onTouchEnd={onStageTouchEnd}
            onMouseLeave={endStroke}
            onDblClick={onStageDblClick}
            onDblTap={onStageDblClick}
            onContextMenu={onStageContextMenu}
            style={{ cursor: tool === 'pan' ? 'grab' : (tool === 'land' || tool === 'sea') ? 'crosshair' : (tool === 'stamp' || tool === 'scatter') ? 'copy' : 'default' }}
          >
            <Layer
              ref={layerRef}
              x={view.x} y={view.y} scaleX={view.scale} scaleY={view.scale}
              draggable={layerDraggable}
              onDragEnd={(e) => { if (e.target.getClassName() === 'Layer') setView((v) => ({ ...v, x: e.target.x(), y: e.target.y() })); }}
            >
              {/* Page / background */}
              <Rect name="bg" x={0} y={0} width={W} height={H} fill={doc.canvas.background.value}
                stroke="#0000001a" strokeWidth={1 / view.scale} shadowColor="#000" shadowBlur={16} shadowOpacity={0.18} />
              {parchment && (
                <KonvaImage image={parchment} x={0} y={0} width={W} height={H} listening={false} />
              )}

              {/* Terrain */}
              {lm.terrain.visible && terrainCanvas && (
                <KonvaImage image={terrainCanvas} x={0} y={0} width={W} height={H} listening={false} imageSmoothingEnabled />
              )}
              {lm.terrain.visible && terrainImg && (
                <KonvaImage image={terrainImg} x={0} y={0} width={W} height={H} listening={false} />
              )}

              {/* Inked coastline (hand-drawn style): a smooth vector contour over
                  the soft raster — a faint wide wash seats it, a crisp line inks it. */}
              {lm.terrain.visible && isInk && coastLines && coastLines.length > 0 && (
                <>
                  <CoastShape lines={coastLines} stroke="#5f8aa1" width={4.2 / view.scale} opacity={0.22} />
                  <CoastShape lines={coastLines} stroke={INK} width={1.5 / view.scale} opacity={0.95} />
                </>
              )}

              {/* Grid */}
              {doc.grid.type !== 'none' && (
                <GridLayer type={doc.grid.type} W={W} H={H} size={doc.grid.size} color={doc.grid.color} opacity={doc.grid.opacity} scale={view.scale} />
              )}

              {/* Regions */}
              {lm.regions.visible && sortedRegions.map((r) => (
                <RegionShape key={r.id} region={r} selected={selection?.id === r.id} scale={view.scale}
                  selectable={selectable && !lm.regions.locked && !r.locked}
                  onSelect={() => setSelection({ type: 'region', id: r.id })}
                  onDragStart={onObjDragStart}
                  onMoved={(pts) => patchObject('region', r.id, { points: pts }, false)} />
              ))}

              {/* Routes */}
              {lm.routes.visible && sortedRoutes.map((r) => (
                <RouteShape key={r.id} route={r} selected={selection?.id === r.id} ink={isInk} paper={halo}
                  selectable={selectable && !lm.routes.locked && !r.locked}
                  onSelect={() => setSelection({ type: 'route', id: r.id })}
                  onDragStart={onObjDragStart}
                  onMoved={(pts) => patchObject('route', r.id, { points: pts }, false)} />
              ))}

              {/* Region labels (sized by tier, centred by measured width, haloed) */}
              {lm.regions.visible && sortedRegions.map((r) => {
                if (!r.labelPos || !r.name) return null;
                const def = regionLevelDef(r.level);
                const fs = def.labelSize;
                const realm = (r.level ?? 'realm') === 'realm';
                const text = realm ? r.name.toUpperCase() : r.name;
                const spacing = realm ? fs * 0.16 : fs * 0.04;
                const width = measureText(text, fs, labelFont, true) + spacing * Math.max(0, text.length - 1);
                return (
                  <Text key={r.id + '_t'} text={text} x={r.labelPos.x} y={r.labelPos.y} fontSize={fs} fontStyle="bold"
                    fill={isInk ? '#4a3a22' : '#2b2317'} fontFamily={labelFont} letterSpacing={spacing}
                    stroke={halo} strokeWidth={fs * 0.22} fillAfterStrokeEnabled lineJoin="round"
                    offsetX={width / 2} offsetY={fs / 2} listening={false} opacity={0.92} />
                );
              })}

              {/* Items */}
              {lm.items.visible && sortedItems.map((it) => (
                <ItemNode key={it.id} item={it} selectable={selectable && !lm.items.locked && !it.locked}
                  paper={paperColor}
                  onSelect={() => setSelection({ type: 'item', id: it.id })}
                  onName={() => startNaming(it.id)}
                  onDragStart={onObjDragStart}
                  onChange={(patch) => patchObject('item', it.id, patch, false)}
                  snap={snapPt} />
              ))}

              {/* Item captions (red serif place-names in the hand-drawn style) */}
              {lm.items.visible && sortedItems.map((it) => it.label && (
                <Text key={it.id + '_c'} text={it.label} x={it.x} y={it.y + (it.height * it.scale) / 2 + 2}
                  fontSize={13} fontStyle="bold" fill={labelFill} fontFamily={labelFont}
                  stroke={halo} strokeWidth={2.6} fillAfterStrokeEnabled lineJoin="round"
                  offsetX={measureText(it.label, 13, labelFont, true) / 2} listening={false} />
              ))}

              {/* Labels */}
              {lm.labels.visible && doc.labels.map((l) => (
                <Text key={l.id} id={l.id} text={l.text} x={l.x} y={l.y} fontSize={l.size} rotation={l.rotation}
                  fill={l.color} fontStyle={l.bold ? 'bold' : 'normal'} fontFamily={labelFont}
                  stroke={halo} strokeWidth={l.size * 0.18} fillAfterStrokeEnabled lineJoin="round"
                  draggable={selectable && !lm.labels.locked && !l.locked}
                  onClick={() => selectable && setSelection({ type: 'label', id: l.id })}
                  onTap={() => selectable && setSelection({ type: 'label', id: l.id })}
                  onDragStart={onObjDragStart}
                  onDragEnd={(e) => patchObject('label', l.id, { x: e.target.x(), y: e.target.y() }, false)}
                  onTransformEnd={(e) => {
                    const node = e.target as Konva.Text;
                    const sc = node.scaleY();
                    patchObject('label', l.id, { size: Math.max(8, Math.round(l.size * sc)), rotation: Math.round(node.rotation()) }, false);
                    node.scaleX(1); node.scaleY(1);
                  }} />
              ))}

              {/* Region edit handles (selected region, select tool) */}
              {editableRegion && (
                <RegionEditHandles region={editableRegion} scale={view.scale}
                  onSnapshot={onObjDragStart}
                  onChange={(pts) => patchObject('region', editableRegion.id, { points: pts }, false)} />
              )}

              {/* In-progress route draft */}
              {draft && draft.kind === 'route' && (
                <Line points={draft.points} stroke="#2563eb" strokeWidth={2 / view.scale} dash={[8 / view.scale, 6 / view.scale]} listening={false} />
              )}

              {/* In-progress region boundary (open path + rubber-band + start dot) */}
              {draft && draft.kind === 'region' && (
                <>
                  <Line points={penCursor ? [...draft.points, penCursor.x, penCursor.y] : draft.points}
                    stroke="#2563eb" strokeWidth={1.8 / view.scale} dash={[6 / view.scale, 5 / view.scale]}
                    lineCap="round" lineJoin="round" listening={false} />
                  {!extending && (
                    <Circle x={draft.points[0]} y={draft.points[1]} radius={(nearStart ? 8 : 5) / view.scale}
                      stroke="#2563eb" strokeWidth={2 / view.scale} fill={nearStart ? '#2563eb' : '#ffffff'} listening={false} />
                  )}
                </>
              )}

              {/* Decorative map chrome (hand-drawn style): frame, compass, title cartouche */}
              {isInk && (
                <MapChrome W={W} H={H} scale={view.scale} decor={doc.decor} title={docProp.title} compassImg={compassImg} />
              )}

              <Transformer ref={trRef} rotateEnabled keepRatio
                anchorSize={isMobile ? 14 : 9} borderStroke="#2563eb" anchorStroke="#2563eb"
                boundBoxFunc={(oldB, newB) => (newB.width < 8 || newB.height < 8 ? oldB : newB)} />
            </Layer>
          </Stage>

          {/* Brush cursor (size preview) */}
          {brushCursor && BRUSH_TOOLS.includes(tool) && (() => {
            const r = (tool === 'sea' && seaMode === 'river' ? brushSize * 0.5 : brushSize) * view.scale;
            return (
              <div
                className="fm-brush-cursor"
                style={{
                  left: brushCursor.x,
                  top: brushCursor.y,
                  width: Math.max(6, r * 2),
                  height: Math.max(6, r * 2),
                  borderColor: tool === 'sea' ? '#2f7dbf' : tool === 'land' ? '#3f9e57' : '#8a5ad6',
                }}
              />
            );
          })()}

          {/* Inline asset naming (double-click an asset) */}
          {namingItem && (
            <input
              autoFocus
              className="fm-name-input"
              style={{
                left: view.x + namingItem.x * view.scale,
                top: view.y + (namingItem.y + (namingItem.height * namingItem.scale) / 2 + 8) * view.scale,
              }}
              value={namingItem.label ?? ''}
              placeholder="Name…"
              onChange={(e) => patchObject('item', namingItem.id, { label: e.target.value }, false)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); setNaming(null); } }}
              onBlur={() => setNaming(null)}
            />
          )}

          {/* Empty hint */}
          {doc.terrain.mode === 'none' && doc.items.length === 0 && doc.regions.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="text-center text-muted-foreground/60 max-w-xs">
                <Wand2 className="w-8 h-8 mx-auto mb-3 opacity-50" />
                <p className="text-sm font-medium mb-1">{kindDef.title}</p>
                <p className="text-xs leading-relaxed">Hit <b>Generate</b> for an instant world — or grab the <b>Land brush</b> and paint your own coastline, then scatter forests &amp; towns with the library.</p>
              </div>
            </div>
          )}
        </div>

        {/* Right inspector */}
        {rightOpen && (
          <div className={panelCls('right')}>
            <InspectorPanel
              doc={doc} selection={selection}
              onPatchObject={(t, id, p) => patchObject(t, id, p)}
              onDeleteObject={deleteObject}
              onPatchCanvas={onPatchCanvas} onPatchBackground={onPatchBackground} onPatchGrid={onPatchGrid}
              onResizeCanvas={onResizeCanvas} onSetRuggedness={onSetRuggedness}
              onToggleLayer={onToggleLayer} onChangeKind={onChangeKind}
              onChangeStyle={onChangeStyle} onToggleDecor={onToggleDecor} onExport={exportPng}
            />
          </div>
        )}
      </div>

      {/* Context menu */}
      {ctxMenu && createPortal(
        <>
          <div className="fixed inset-0 z-[998]" onPointerDown={() => setCtxMenu(null)} onContextMenu={(e) => { e.preventDefault(); setCtxMenu(null); }} />
          <div className="fixed z-[999] min-w-[180px] p-1.5 rounded-xl border border-border/60 bg-popover text-popover-foreground shadow-[0_12px_40px_rgba(0,0,0,0.4)]"
            style={{ left: Math.min(ctxMenu.x, window.innerWidth - 196), top: Math.min(ctxMenu.y, window.innerHeight - 260) }}>
            {ctxMenu.sel ? (
              <>
                {ctxMenu.sel.type === 'item' && (
                  <>
                    <CtxItem icon={Copy} label="Copy" onSelect={() => copyItem(ctxMenu.sel!.id)} />
                    <CtxItem icon={Copy} label="Duplicate" onSelect={() => { const it = doc.items.find((i) => i.id === ctxMenu.sel!.id); if (it) { const n = { ...it, id: mapId('it'), x: it.x + 24, y: it.y + 24, z: nextZ(doc.items) }; mutate((d) => ({ ...d, items: [...d.items, n] })); setSelection({ type: 'item', id: n.id }); } setCtxMenu(null); }} />
                  </>
                )}
                <CtxItem icon={ArrowUpToLine} label="Bring to front" onSelect={() => reorder(ctxMenu.sel!.type, ctxMenu.sel!.id, true)} />
                <CtxItem icon={ArrowDownToLine} label="Send to back" onSelect={() => reorder(ctxMenu.sel!.type, ctxMenu.sel!.id, false)} />
                <CtxItem icon={Lock} label="Lock / unlock" onSelect={() => { const t = ctxMenu.sel!.type; const arr = doc[`${t}s` as 'items'] as Array<{ id: string; locked?: boolean }>; const o = arr.find((x) => x.id === ctxMenu.sel!.id); patchObject(t, ctxMenu.sel!.id, { locked: !o?.locked }, false); setCtxMenu(null); }} />
                <div className="h-px bg-border/40 my-1" />
                <CtxItem icon={Trash2} label="Delete" danger onSelect={() => deleteObject(ctxMenu.sel!.type, ctxMenu.sel!.id)} />
              </>
            ) : hasClipboard ? (
              <CtxItem icon={ClipboardPaste} label="Paste here" onSelect={() => { const rect = wrapRef.current?.getBoundingClientRect(); const m = { x: (ctxMenu.x - (rect?.left ?? 0) - view.x) / view.scale, y: (ctxMenu.y - (rect?.top ?? 0) - view.y) / view.scale }; const src = clipboard.current!; const n: MapItem = { ...src, id: mapId('it'), x: m.x, y: m.y, z: nextZ(doc.items) }; mutate((d) => ({ ...d, items: [...d.items, n] })); setSelection({ type: 'item', id: n.id }); setCtxMenu(null); }} />
            ) : (
              <div className="px-2.5 py-2 text-xs text-muted-foreground/70 italic flex items-center gap-2"><ImageIcon className="w-4 h-4" />Right-click an object for actions</div>
            )}
          </div>
        </>,
        window.document.body,
      )}
    </div>
  );
}

/* ── export helpers ──────────────────────────────────────────────────────── */

function dataUrlToBytes(url: string): Uint8Array {
  const b64 = url.slice(url.indexOf(',') + 1);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Save a rendered PNG:
 *   desktop app → native "Save as…" dialog;
 *   Android     → the project's exports/ folder (no save dialog on mobile);
 *   browser     → a regular download.
 * Returns a human-readable location, or null if the user cancelled.
 */
async function savePng(url: string, name: string, projectId: string): Promise<string | null> {
  if (isTauri && !isMobileOS) {
    const [{ save }, { writeFile }] = await Promise.all([import('@tauri-apps/plugin-dialog'), import('@tauri-apps/plugin-fs')]);
    const path = await save({ defaultPath: name, filters: [{ name: 'PNG image', extensions: ['png'] }] });
    if (!path) return null;
    await writeFile(path, dataUrlToBytes(url));
    return path;
  }
  if (isTauri) {
    return api.exportFile(projectId, name, dataUrlToBytes(url));
  }
  const a = window.document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  return name;
}

/* ── text measurement (label centring) ───────────────────────────────────── */
let measureCtx: CanvasRenderingContext2D | null = null;
const measureCache = new Map<string, number>();
function measureText(text: string, size: number, family: string, bold: boolean): number {
  const key = `${size}|${family}|${bold ? 'b' : 'n'}|${text}`;
  const hit = measureCache.get(key);
  if (hit != null) return hit;
  if (!measureCtx) measureCtx = window.document.createElement('canvas').getContext('2d');
  if (!measureCtx) return text.length * size * 0.55;
  measureCtx.font = `${bold ? 'bold ' : ''}${size}px ${family}`;
  const w = measureCtx.measureText(text).width;
  if (measureCache.size > 4000) measureCache.clear();
  measureCache.set(key, w);
  return w;
}

/* ── Konva sub-nodes (each needs its own image hook) ─────────────────────── */

function ItemNode({ item, selectable, paper, onSelect, onName, onDragStart, onChange, snap }: {
  item: MapItem; selectable: boolean; paper: string; onSelect: () => void; onName: () => void;
  onDragStart: () => void; onChange: (patch: Partial<MapItem>) => void; snap: (n: number) => number;
}) {
  const img = useImage(toItemUrl(item, paper));
  if (!img) return null;
  const w = item.width;
  const h = item.height;
  return (
    <KonvaImage
      id={item.id}
      image={img}
      x={item.x}
      y={item.y}
      width={w}
      height={h}
      offsetX={w / 2}
      offsetY={h / 2}
      scaleX={(item.flipX ? -1 : 1) * item.scale}
      scaleY={item.scale}
      rotation={item.rotation}
      draggable={selectable}
      onMouseDown={(e) => { if (selectable) { e.cancelBubble = true; onSelect(); } }}
      onClick={(e) => { if (selectable) { e.cancelBubble = true; onSelect(); } }}
      onTap={(e) => { if (selectable) { e.cancelBubble = true; onSelect(); } }}
      onTouchStart={(e) => { if (selectable) { e.cancelBubble = true; onSelect(); } }}
      onDblClick={(e) => { if (selectable) { e.cancelBubble = true; onName(); } }}
      onDblTap={(e) => { if (selectable) { e.cancelBubble = true; onName(); } }}
      onDragStart={onDragStart}
      onDragEnd={(e) => onChange({ x: snap(e.target.x()), y: snap(e.target.y()) })}
      onTransformEnd={(e) => {
        const node = e.target as Konva.Image;
        const s = Math.abs(node.scaleY());
        onChange({ scale: Math.max(0.1, s), rotation: Math.round(node.rotation()) });
      }}
    />
  );
}

/** Smooth coastline polylines drawn in one canvas pass. */
function CoastShape({ lines, stroke, width, opacity }: { lines: number[][]; stroke: string; width: number; opacity: number }) {
  return (
    <Shape
      listening={false}
      stroke={stroke}
      strokeWidth={width}
      opacity={opacity}
      lineCap="round"
      lineJoin="round"
      sceneFunc={(ctx, shape) => {
        ctx.beginPath();
        for (const poly of lines) {
          ctx.moveTo(poly[0], poly[1]);
          for (let i = 2; i < poly.length; i += 2) ctx.lineTo(poly[i], poly[i + 1]);
        }
        ctx.strokeShape(shape);
      }}
    />
  );
}

function RegionShape({ region, selected, selectable, scale, onSelect, onDragStart, onMoved }: {
  region: MapRegion; selected: boolean; selectable: boolean; scale: number;
  onSelect: () => void; onDragStart: () => void; onMoved: (pts: number[]) => void;
}) {
  const def = regionLevelDef(region.level);
  return (
    <Line
      points={region.points}
      closed
      // Border-first: a dotted outline whose weight/dash come from the region's
      // tier. Fill is off by default (no colour overcoat); a generous hit width
      // keeps the dotted border easy to click for selection.
      fill={region.showFill ? withAlpha(region.fill, region.opacity) : 'transparent'}
      stroke={selected ? '#2563eb' : region.stroke}
      strokeWidth={(selected ? def.width + 0.8 : def.width) / scale}
      dash={[def.dash[0] / scale, def.dash[1] / scale]}
      lineCap="round"
      lineJoin="round"
      tension={0.04}
      hitStrokeWidth={Math.max(14, def.width + 10) / scale}
      draggable={selectable}
      onMouseDown={(e) => { if (selectable) { e.cancelBubble = true; onSelect(); } }}
      onClick={(e) => { if (selectable) { e.cancelBubble = true; onSelect(); } }}
      onTap={(e) => { if (selectable) { e.cancelBubble = true; onSelect(); } }}
      onTouchStart={(e) => { if (selectable) { e.cancelBubble = true; onSelect(); } }}
      onDragStart={onDragStart}
      onDragEnd={(e) => { const dx = e.target.x(); const dy = e.target.y(); e.target.position({ x: 0, y: 0 }); onMoved(shiftPoints(region.points, dx, dy)); }}
    />
  );
}

/** Append an alpha byte to a #rgb / #rrggbb colour (a in 0..1). */
function withAlpha(hex: string, a: number): string {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const aa = Math.round(Math.max(0, Math.min(1, a)) * 255).toString(16).padStart(2, '0');
  return `#${h}${aa}`;
}

/* ── region geometry ─────────────────────────────────────────────────────── */
function toPairs(flat: number[]): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < flat.length; i += 2) out.push([flat[i], flat[i + 1]]);
  return out;
}
function flattenPairs(pairs: [number, number][]): number[] {
  const out: number[] = [];
  for (const [x, y] of pairs) out.push(x, y);
  return out;
}
function polyArea(flat: number[]): number {
  const p = toPairs(flat);
  let a = 0;
  for (let i = 0, n = p.length; i < n; i++) { const [x1, y1] = p[i]; const [x2, y2] = p[(i + 1) % n]; a += x1 * y2 - x2 * y1; }
  return Math.abs(a) / 2;
}
function pointInPoly(flat: number[], x: number, y: number): boolean {
  const p = toPairs(flat);
  let inside = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [xi, yi] = p[i]; const [xj, yj] = p[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-9) + xi) inside = !inside;
  }
  return inside;
}
function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy || 1;
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
function distToRing(flat: number[], x: number, y: number): number {
  const p = toPairs(flat);
  let min = Infinity;
  for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; min = Math.min(min, segDist(x, y, a[0], a[1], b[0], b[1])); }
  return min;
}
function nearestVertex(pairs: [number, number][], px: number, py: number): number {
  let best = 0, bd = Infinity;
  for (let i = 0; i < pairs.length; i++) { const d = (pairs[i][0] - px) ** 2 + (pairs[i][1] - py) ** 2; if (d < bd) { bd = d; best = i; } }
  return best;
}
/** Splice an open arc into a ring between its two nearest vertices; keep the larger-area result (grow). */
function extendRegion(flatRing: number[], flatArc: number[]): number[] | null {
  const ring = toPairs(flatRing);
  const arc = toPairs(flatArc);
  if (ring.length < 3 || arc.length < 2) return null;
  const n = ring.length;
  const i0 = nearestVertex(ring, arc[0][0], arc[0][1]);
  const i1 = nearestVertex(ring, arc[arc.length - 1][0], arc[arc.length - 1][1]);
  if (i0 === i1) return null;
  const between = (a: number, b: number): [number, number][] => {
    const out: [number, number][] = [];
    let k = (a + 1) % n;
    while (k !== b) { out.push(ring[k]); k = (k + 1) % n; }
    return out;
  };
  const cand1 = [...arc, ...between(i1, i0)];                   // replace the i0→i1 boundary with the arc
  const cand2 = [...arc.slice().reverse(), ...between(i0, i1)]; // replace the complementary boundary
  const f1 = flattenPairs(cand1), f2 = flattenPairs(cand2);
  if (f1.length < 6 && f2.length < 6) return null;
  return polyArea(f1) >= polyArea(f2) ? f1 : f2;
}
function smallestContainer(regions: MapRegion[], x: number, y: number): MapRegion | undefined {
  let best: MapRegion | undefined; let bestA = Infinity;
  for (const r of regions) {
    if (r.points.length < 6 || !pointInPoly(r.points, x, y)) continue;
    const a = polyArea(r.points);
    if (a < bestA) { bestA = a; best = r; }
  }
  return best;
}

/** Draggable vertex + edge-midpoint handles for reshaping a selected region. */
function RegionEditHandles({ region, scale, onSnapshot, onChange }: {
  region: MapRegion; scale: number; onSnapshot: () => void; onChange: (pts: number[]) => void;
}) {
  const pts = region.points;
  const n = pts.length / 2;
  const r = 5 / scale;
  const verts: [number, number][] = [];
  for (let i = 0; i < n; i++) verts.push([pts[i * 2], pts[i * 2 + 1]]);
  const insertAt = (i: number, x: number, y: number) => { onSnapshot(); const np = pts.slice(); np.splice((i + 1) * 2, 0, x, y); onChange(np); };
  const deleteAt = (i: number) => { if (n <= 3) return; onSnapshot(); const np = pts.slice(); np.splice(i * 2, 2); onChange(np); };
  return (
    <>
      {/* edge midpoints — click/tap to insert a vertex */}
      {verts.map((v, i) => {
        const b = verts[(i + 1) % n];
        const mx = (v[0] + b[0]) / 2, my = (v[1] + b[1]) / 2;
        return (
          <Circle key={'m' + i} x={mx} y={my} radius={r * 0.7} stroke="#2563eb" strokeWidth={1 / scale} fill="#ffffff" opacity={0.6}
            onMouseDown={(e) => { e.cancelBubble = true; insertAt(i, mx, my); }}
            onTap={(e) => { e.cancelBubble = true; insertAt(i, mx, my); }} />
        );
      })}
      {/* vertices — drag to move, double-click/tap to delete */}
      {verts.map((v, i) => (
        <Circle key={'v' + i} x={v[0]} y={v[1]} radius={r} draggable stroke="#2563eb" strokeWidth={1.5 / scale} fill="#ffffff"
          onMouseDown={(e) => { e.cancelBubble = true; }}
          onTouchStart={(e) => { e.cancelBubble = true; }}
          onDragStart={(e) => { e.cancelBubble = true; onSnapshot(); }}
          onDragMove={(e) => { const np = pts.slice(); np[i * 2] = e.target.x(); np[i * 2 + 1] = e.target.y(); onChange(np); }}
          onDblClick={(e) => { e.cancelBubble = true; deleteAt(i); }}
          onDblTap={(e) => { e.cancelBubble = true; deleteAt(i); }} />
      ))}
    </>
  );
}

function RouteShape({ route, selected, selectable, ink, paper, onSelect, onDragStart, onMoved }: {
  route: MapRoute; selected: boolean; selectable: boolean; ink: boolean; paper: string;
  onSelect: () => void; onDragStart: () => void; onMoved: (pts: number[]) => void;
}) {
  const river = route.kind === 'river';
  const handlers = {
    onMouseDown: (e: KonvaEventObject<MouseEvent>) => { if (selectable) { e.cancelBubble = true; onSelect(); } },
    onClick: (e: KonvaEventObject<MouseEvent>) => { if (selectable) { e.cancelBubble = true; onSelect(); } },
    onTap: (e: KonvaEventObject<Event>) => { if (selectable) { e.cancelBubble = true; onSelect(); } },
    onTouchStart: (e: KonvaEventObject<TouchEvent>) => { if (selectable) { e.cancelBubble = true; onSelect(); } },
    onDragStart,
    onDragEnd: (e: KonvaEventObject<DragEvent>) => { const dx = e.target.x(); const dy = e.target.y(); e.target.position({ x: 0, y: 0 }); onMoved(shiftPoints(route.points, dx, dy)); },
  };
  return (
    <>
      {/* Hand-drawn roads get a paper-coloured casing so they read over terrain. */}
      {ink && !river && (
        <Line points={route.points} stroke={paper} strokeWidth={route.width + 3} lineCap="round" lineJoin="round" tension={0.25} listening={false} opacity={0.85} />
      )}
      <Line
        points={route.points}
        stroke={selected ? '#2563eb' : route.color}
        strokeWidth={route.width}
        dash={route.dashed ? [route.width * 2, route.width * 1.5] : undefined}
        lineCap="round"
        lineJoin="round"
        tension={river ? 0.4 : 0.25}
        hitStrokeWidth={Math.max(12, route.width + 8)}
        draggable={selectable}
        {...handlers}
      />
    </>
  );
}

function GridLayer({ type, W, H, size, color, opacity, scale }: {
  type: 'square' | 'hex'; W: number; H: number; size: number; color: string; opacity: number; scale: number;
}) {
  return (
    <Shape
      listening={false}
      opacity={opacity}
      stroke={color}
      strokeWidth={1 / scale}
      sceneFunc={(ctx, shape) => {
        ctx.beginPath();
        if (type === 'square') {
          for (let x = 0; x <= W; x += size) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
          for (let y = 0; y <= H; y += size) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
        } else {
          // hex (pointy-top)
          const r = size / 2;
          const hw = Math.sqrt(3) * r;
          for (let row = 0, y = 0; y < H + 2 * r; row++, y += r * 1.5) {
            const offset = row % 2 ? hw / 2 : 0;
            for (let x = -hw; x < W + hw; x += hw) {
              const cx = x + offset;
              for (let k = 0; k < 6; k++) {
                const ang = (Math.PI / 180) * (60 * k - 90);
                const px = cx + r * Math.cos(ang);
                const py = y + r * Math.sin(ang);
                if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
              }
              ctx.closePath();
            }
          }
        }
        ctx.strokeShape(shape);
      }}
    />
  );
}

function CtxItem({ icon: Icon, label, danger, onSelect }: { icon: typeof Copy; label: string; danger?: boolean; onSelect: () => void }) {
  return (
    <button type="button" onPointerDown={(e) => e.stopPropagation()} onClick={onSelect}
      className={`flex items-center gap-2.5 w-full text-left px-2.5 py-2 rounded-md cursor-pointer transition-colors ${danger ? 'text-destructive hover:bg-destructive/10' : 'text-foreground/90 hover:bg-secondary/60'}`}>
      <Icon className="w-4 h-4 shrink-0" /><span className="text-sm font-medium">{label}</span>
    </button>
  );
}

/* ── decorative map chrome (hand-drawn style) ────────────────────────────── */
function MapChrome({ W, H, scale, decor, title, compassImg }: {
  W: number; H: number; scale: number; decor: MapDecor; title: string; compassImg: HTMLImageElement | undefined;
}) {
  const ink = '#6b5436';
  const m = Math.max(16, Math.min(W, H) * 0.022);    // outer margin
  const gap = Math.max(5, Math.min(W, H) * 0.009);   // double-line gap
  const cs = Math.min(W, H) * 0.13;                  // compass size
  const cpad = m + gap + cs * 0.12;
  const fontSize = Math.min(W, H) * 0.034;
  const tw = Math.min(W * 0.72, Math.max(measureText(title, fontSize, SERIF_FONT, true) + fontSize * 2.4, fontSize * 6));
  const th = fontSize * 1.85;
  const bx = (W - tw) / 2;
  const by = m + gap * 1.6;

  return (
    <>
      {decor.frame && (
        <Shape
          listening={false}
          sceneFunc={(konvaCtx) => {
            const ctx = konvaCtx as unknown as CanvasRenderingContext2D;
            ctx.strokeStyle = ink;
            ctx.fillStyle = ink;
            ctx.lineJoin = 'miter';
            ctx.lineWidth = 2.6 / scale;
            ctx.strokeRect(m, m, W - 2 * m, H - 2 * m);
            ctx.lineWidth = 1.2 / scale;
            ctx.strokeRect(m + gap, m + gap, W - 2 * (m + gap), H - 2 * (m + gap));
            // corner diamonds on the inner frame
            const ds = Math.min(W, H) * 0.012;
            for (const cx of [m + gap, W - m - gap]) {
              for (const cy of [m + gap, H - m - gap]) {
                ctx.beginPath();
                ctx.moveTo(cx, cy - ds); ctx.lineTo(cx + ds, cy); ctx.lineTo(cx, cy + ds); ctx.lineTo(cx - ds, cy);
                ctx.closePath(); ctx.fill();
              }
            }
          }}
        />
      )}

      {decor.compass && compassImg && (
        <KonvaImage image={compassImg} x={cpad} y={H - cpad - cs} width={cs} height={cs} listening={false} opacity={0.9} />
      )}

      {decor.cartouche && title && (
        <>
          <Rect x={bx} y={by} width={tw} height={th} cornerRadius={th * 0.22}
            fill="#efe2c2" stroke={ink} strokeWidth={1.4 / scale} opacity={0.96} listening={false}
            shadowColor="#000" shadowBlur={10} shadowOpacity={0.18} />
          <Rect x={bx + gap} y={by + gap} width={tw - 2 * gap} height={th - 2 * gap} cornerRadius={th * 0.16}
            stroke={ink} strokeWidth={0.7 / scale} opacity={0.7} listening={false} />
          <Text x={bx} y={by} width={tw} height={th} text={title} align="center" verticalAlign="middle"
            fontSize={fontSize} fontStyle="bold" fontFamily={SERIF_FONT} fill="#3a2a1c" letterSpacing={fontSize * 0.08} listening={false} />
        </>
      )}
    </>
  );
}

/* ── helpers ─────────────────────────────────────────────────────────────── */
function shiftPoints(points: number[], dx: number, dy: number): number[] {
  return points.map((v, i) => (i % 2 === 0 ? v + dx : v + dy));
}
function avg(points: number[], offset: 0 | 1): number {
  let sum = 0; let n = 0;
  for (let i = offset; i < points.length; i += 2) { sum += points[i]; n++; }
  return n ? sum / n : 0;
}
function fileName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}
