import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Stage, Layer, Rect, Line, Image as KonvaImage, Text, Transformer, Shape } from 'react-konva';
import type Konva from 'konva';
import type { KonvaEventObject } from 'konva/lib/Node';
import {
  MousePointer2, Hand, MapPin, Hexagon, Spline, Type as TypeIcon,
  Undo2, Redo2, Wand2, ZoomIn, ZoomOut, Maximize, Save, PanelLeft, PanelRight,
  Copy, Trash2, ArrowUpToLine, ArrowDownToLine, Lock, ClipboardPaste, Image as ImageIcon,
} from 'lucide-react';
import type { Document } from '../types';
import type { ThemeType } from '../App';
import { api } from '../lib/api';
import { toAssetUrl } from '../lib/assets';
import { toItemUrl } from '../lib/mapAssets';
import { useMediaQuery } from '../lib/useMediaQuery';
import type {
  FantasyMapDoc, GenParams, MapItem, MapRegion, MapRoute, MapLabel, MapKind, LayerId,
} from './fantasymap/mapTypes';
import { parseMapDoc, mapId, mapKindDef, DEFAULT_GEN_PARAMS } from './fantasymap/mapTypes';
import { buildHeightField, renderTerrainCanvas, generateMap, randomSeed } from './fantasymap/generator';
import { useImage } from './fantasymap/useImage';
import { useMapHistory } from './fantasymap/useMapHistory';
import LibraryPanel, { type PickedIcon } from './fantasymap/LibraryPanel';
import GeneratePanel from './fantasymap/GeneratePanel';
import InspectorPanel, { type Selection, type SelType } from './fantasymap/InspectorPanel';

interface FantasyMapProps {
  document: Document;
  projectId: string;
  onUpdateContent: (content: string) => void;
  onRequestSave: () => void;
  theme: ThemeType;
}

type Tool = 'select' | 'pan' | 'stamp' | 'region' | 'route' | 'label';
const TOOLS: { id: Tool; label: string; Icon: typeof MousePointer2 }[] = [
  { id: 'select', label: 'Select / move', Icon: MousePointer2 },
  { id: 'pan', label: 'Pan', Icon: Hand },
  { id: 'stamp', label: 'Place icon', Icon: MapPin },
  { id: 'region', label: 'Draw region', Icon: Hexagon },
  { id: 'route', label: 'Draw road / river', Icon: Spline },
  { id: 'label', label: 'Add label', Icon: TypeIcon },
];

type CtxMenu = { x: number; y: number; sel: Selection | null } | null;

export default function FantasyMap({ document: docProp, projectId, onUpdateContent, onRequestSave }: FantasyMapProps) {
  const isMobile = useMediaQuery('(max-width: 768px)');

  // Parse once on mount (component is keyed by document id in App, like MindMap).
  const [doc, setDoc] = useState<FantasyMapDoc>(() => parseMapDoc(docProp.content));
  const docRef = useRef(doc);
  docRef.current = doc;

  const history = useMapHistory();
  const [tool, setTool] = useState<Tool>('select');
  const [picked, setPicked] = useState<PickedIcon | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [draft, setDraft] = useState<{ kind: 'region' | 'route'; points: number[] } | null>(null);
  const [genOpen, setGenOpen] = useState(false);
  const [genParams, setGenParams] = useState<GenParams>({ ...DEFAULT_GEN_PARAMS, seed: randomSeed() });
  const [ctxMenu, setCtxMenu] = useState<CtxMenu>(null);
  const clipboard = useRef<MapItem | null>(null);

  const [leftOpen, setLeftOpen] = useState(!isMobile);
  const [rightOpen, setRightOpen] = useState(!isMobile);
  useEffect(() => { setLeftOpen(!isMobile); setRightOpen(!isMobile); }, [isMobile]);

  // ── Mutation + history ────────────────────────────────────────────────
  const mutate = useCallback((fn: (d: FantasyMapDoc) => FantasyMapDoc, snap = true) => {
    if (snap) history.snapshot(docRef.current);
    setDoc((prev) => fn(prev));
  }, [history]);

  const doUndo = useCallback(() => { const p = history.undo(docRef.current); if (p) { setDoc(p); setSelection(null); } }, [history]);
  const doRedo = useCallback(() => { const n = history.redo(docRef.current); if (n) { setDoc(n); setSelection(null); } }, [history]);

  // ── Persist (debounced) after the first render ────────────────────────
  const didMount = useRef(false);
  useEffect(() => {
    if (!didMount.current) { didMount.current = true; return; }
    const t = setTimeout(() => onUpdateContent(JSON.stringify(doc)), 400);
    return () => clearTimeout(t);
  }, [doc, onUpdateContent]);

  // ── Stage sizing ──────────────────────────────────────────────────────
  const wrapRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const trRef = useRef<Konva.Transformer>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // ── View (pan / zoom) ─────────────────────────────────────────────────
  const [view, setView] = useState({ x: 40, y: 40, scale: 0.5 });
  const W = doc.canvas.width;
  const H = doc.canvas.height;

  const fitToScreen = useCallback(() => {
    const pad = 40;
    const scale = Math.min((size.w - pad * 2) / W, (size.h - pad * 2) / H);
    const s = Math.max(0.05, Math.min(scale, 4));
    setView({ x: (size.w - W * s) / 2, y: (size.h - H * s) / 2, scale: s });
  }, [size, W, H]);

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
    setView((v) => {
      const dir = e.evt.deltaY > 0 ? 0.9 : 1.1;
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

  // ── Terrain raster (derived from seed+params; not persisted) ──────────
  const [terrainCanvas, setTerrainCanvas] = useState<HTMLCanvasElement | null>(null);
  useEffect(() => {
    if (doc.terrain.mode === 'generated' && doc.terrain.params) {
      const hf = buildHeightField(doc.terrain.params, W, H);
      setTerrainCanvas(renderTerrainCanvas(doc.terrain.params, hf));
    } else {
      setTerrainCanvas(null);
    }
  }, [doc.terrain, W, H]);
  const terrainImg = useImage(doc.terrain.mode === 'image' ? toAssetUrl(doc.terrain.imagePath || '') : undefined);

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

  // ── Keyboard ──────────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = window.document.activeElement as HTMLElement | null;
      const tag = el?.tagName.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || el?.isContentEditable) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); doUndo(); }
      else if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) { e.preventDefault(); doRedo(); }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && selection) { e.preventDefault(); deleteObject(selection.type, selection.id); }
      else if (e.key === 'Escape') { setDraft(null); setSelection(null); setPicked(null); setCtxMenu(null); }
      else if (e.key === 'Enter' && draft) { e.preventDefault(); commitDraft(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Object helpers ────────────────────────────────────────────────────
  const nextZ = (arr: { z: number }[]) => (arr.length ? Math.max(...arr.map((o) => o.z)) + 1 : 0);
  const snap = (n: number) =>
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

  // ── Stamp / draw / label placement ────────────────────────────────────
  const stampAt = (mx: number, my: number) => {
    if (!picked) return;
    const item: MapItem = {
      id: mapId('it'), libId: picked.libId, assetPath: picked.assetPath,
      x: snap(mx), y: snap(my), width: picked.size, height: picked.size,
      scale: 1, rotation: 0, z: nextZ(doc.items), tint: picked.libId ? '#3a2f23' : undefined,
    };
    mutate((d) => ({ ...d, items: [...d.items, item] }));
    setSelection({ type: 'item', id: item.id });
  };

  const addLabel = (mx: number, my: number) => {
    const label: MapLabel = { id: mapId('lb'), text: 'New label', x: mx, y: my, size: 22, color: '#3a2f23', rotation: 0, bold: true };
    mutate((d) => ({ ...d, labels: [...d.labels, label] }));
    setSelection({ type: 'label', id: label.id });
    setTool('select');
  };

  const commitDraft = () => {
    if (!draft) return;
    if (draft.kind === 'region' && draft.points.length >= 6) {
      const region: MapRegion = {
        id: mapId('reg'), name: 'New region', points: draft.points,
        fill: '#5aa05a', stroke: '#3a2f23', opacity: 0.3, z: nextZ(doc.regions),
        labelPos: { x: avg(draft.points, 0), y: avg(draft.points, 1) },
      };
      mutate((d) => ({ ...d, regions: [...d.regions, region] }));
      setSelection({ type: 'region', id: region.id });
    } else if (draft.kind === 'route' && draft.points.length >= 4) {
      const route: MapRoute = {
        id: mapId('rt'), kind: 'road', points: draft.points, color: '#6b4f2a', width: 4, z: nextZ(doc.routes),
      };
      mutate((d) => ({ ...d, routes: [...d.routes, route] }));
      setSelection({ type: 'route', id: route.id });
    }
    setDraft(null);
    setTool('select');
  };

  // ── Stage events ──────────────────────────────────────────────────────
  const onStageMouseDown = (e: KonvaEventObject<MouseEvent>) => {
    setCtxMenu(null);
    const bg = e.target.name() === 'bg' || e.target === stageRef.current;
    const m = pointerToMap();
    if (!m) return;

    if (tool === 'stamp' && picked) { stampAt(m.x, m.y); return; }
    if (tool === 'label') { addLabel(m.x, m.y); return; }
    if (tool === 'region' || tool === 'route') {
      setDraft((dr) => {
        const kind = tool as 'region' | 'route';
        if (!dr || dr.kind !== kind) return { kind, points: [m.x, m.y] };
        return { kind, points: [...dr.points, m.x, m.y] };
      });
      return;
    }
    if (tool === 'select' && bg) setSelection(null);
  };

  const onStageDblClick = () => { if (draft) commitDraft(); };

  const onStageContextMenu = (e: KonvaEventObject<MouseEvent>) => {
    e.evt.preventDefault();
    const sel = selection;
    setCtxMenu({ x: e.evt.clientX, y: e.evt.clientY, sel });
  };

  const layerDraggable = tool === 'pan' || tool === 'select';

  // ── Generate ──────────────────────────────────────────────────────────
  const runGenerate = (params: GenParams) => {
    mutate((d) => {
      const { regions, items } = generateMap(params, d.canvas.width, d.canvas.height);
      return { ...d, terrain: { mode: 'generated', seed: params.seed, params }, regions, items };
    });
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
      shape: shapes[Math.floor(r() * shapes.length)],
      seed: randomSeed(),
      landAmount: 0.35 + r() * 0.45,
      roughness: 2 + Math.floor(r() * 5),
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
    mutate((d) => ({ ...d, terrain: { mode: 'none' }, regions: [], items: [] }));
    setSelection(null);
  };

  // ── Import ────────────────────────────────────────────────────────────
  const importIcons = async () => {
    const paths = await api.importAssets(projectId);
    if (!paths.length) return;
    mutate((d) => ({
      ...d,
      imports: [...d.imports, ...paths.map((p) => ({ id: mapId('imp'), name: fileName(p), path: p }))],
    }));
  };
  const importBackground = async () => {
    const paths = await api.importAssets(projectId);
    if (!paths.length) return;
    mutate((d) => ({ ...d, terrain: { mode: 'image', imagePath: paths[0] } }));
  };

  // ── Export PNG ────────────────────────────────────────────────────────
  const exportPng = () => {
    const stage = stageRef.current;
    if (!stage) return;
    const prev = view;
    const pad = 0;
    const s = Math.min((size.w - pad) / W, (size.h - pad) / H);
    const ox = (size.w - W * s) / 2;
    const oy = (size.h - H * s) / 2;
    setSelection(null);
    setView({ x: ox, y: oy, scale: s });
    requestAnimationFrame(() => {
      const url = stage.toDataURL({ x: ox, y: oy, width: W * s, height: H * s, pixelRatio: Math.max(1, 1.5 / s) });
      const a = window.document.createElement('a');
      a.href = url;
      a.download = `${docProp.title || 'map'}.png`;
      a.click();
      setView(prev);
    });
  };

  // ── Layer settings ────────────────────────────────────────────────────
  const onToggleLayer = (layer: LayerId, key: 'visible' | 'locked') =>
    mutate((d) => ({ ...d, layersMeta: { ...d.layersMeta, [layer]: { ...d.layersMeta[layer], [key]: !d.layersMeta[layer][key] } } }), false);
  const onChangeKind = (kind: MapKind) => mutate((d) => ({ ...d, kind }));
  const onPatchCanvas = (patch: Partial<FantasyMapDoc['canvas']>) => mutate((d) => ({ ...d, canvas: { ...d.canvas, ...patch } }), false);
  const onPatchBackground = (patch: Partial<FantasyMapDoc['canvas']['background']>) =>
    mutate((d) => ({ ...d, canvas: { ...d.canvas, background: { ...d.canvas.background, ...patch } } }), false);
  const onPatchGrid = (patch: Partial<FantasyMapDoc['grid']>) => mutate((d) => ({ ...d, grid: { ...d.grid, ...patch } }), false);

  // ── Drag start (one history snapshot per gesture) ─────────────────────
  const onObjDragStart = () => history.snapshot(docRef.current);

  // ── Sorted draws (respect z) ──────────────────────────────────────────
  const sortedRegions = useMemo(() => [...doc.regions].sort((a, b) => a.z - b.z), [doc.regions]);
  const sortedRoutes = useMemo(() => [...doc.routes].sort((a, b) => a.z - b.z), [doc.routes]);
  const sortedItems = useMemo(() => [...doc.items].sort((a, b) => a.z - b.z), [doc.items]);
  const lm = doc.layersMeta;

  const bgFill = doc.canvas.background.type === 'parchment' ? doc.canvas.background.value : doc.canvas.background.value;

  const selectable = tool === 'select';
  const kindDef = mapKindDef(doc.kind);

  return (
    <div className="flex-1 flex flex-col bg-background overflow-hidden relative">
      {/* Toolbar */}
      <div className="min-h-10 bg-secondary/20 border-b border-border/30 flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1 select-none">
        <div className="flex items-center gap-0.5">
          {TOOLS.map(({ id, label, Icon }) => (
            <button key={id} title={label} onClick={() => { setTool(id); if (id !== 'stamp') setPicked(null); if (id !== 'region' && id !== 'route') setDraft(null); }}
              className={`fm-tool ${tool === id ? 'is-active' : ''}`}>
              <Icon className="w-4 h-4" />
            </button>
          ))}
        </div>

        <div className="flex items-center gap-0.5 pl-2 border-l border-border/30">
          <button onClick={doUndo} disabled={!history.canUndo} className="fm-iconbtn" title="Undo (Ctrl+Z)"><Undo2 className="w-4 h-4" /></button>
          <button onClick={doRedo} disabled={!history.canRedo} className="fm-iconbtn" title="Redo (Ctrl+Y)"><Redo2 className="w-4 h-4" /></button>
        </div>

        <div className="relative pl-2 border-l border-border/30">
          <button onClick={() => setGenOpen((o) => !o)} className="fm-btn fm-btn-primary" title="Auto-generate">
            <Wand2 className="w-3.5 h-3.5" /> Generate
          </button>
          {genOpen && (
            <div className="absolute left-0 top-full mt-1.5 z-[60]">
              <GeneratePanel
                params={genParams} onChange={setGenParams}
                onGenerate={() => { onGenerate(); }}
                onRegenerate={onRegenerate} onRandomize={onRandomize} onClear={onClearGen}
                onClose={() => setGenOpen(false)}
              />
            </div>
          )}
        </div>

        <div className="flex items-center gap-0.5 pl-2 border-l border-border/30">
          <button onClick={() => zoomBy(1.2)} className="fm-iconbtn" title="Zoom in"><ZoomIn className="w-4 h-4" /></button>
          <button onClick={() => zoomBy(0.8)} className="fm-iconbtn" title="Zoom out"><ZoomOut className="w-4 h-4" /></button>
          <button onClick={fitToScreen} className="fm-iconbtn" title="Fit to screen"><Maximize className="w-4 h-4" /></button>
          <span className="text-[11px] text-muted-foreground/70 tabular-nums w-10 text-center">{Math.round(view.scale * 100)}%</span>
        </div>

        <div className="ml-auto flex items-center gap-1">
          <button onClick={() => setLeftOpen((o) => !o)} className={`fm-iconbtn ${leftOpen ? 'text-primary' : ''}`} title="Toggle library"><PanelLeft className="w-4 h-4" /></button>
          <button onClick={() => setRightOpen((o) => !o)} className={`fm-iconbtn ${rightOpen ? 'text-primary' : ''}`} title="Toggle inspector"><PanelRight className="w-4 h-4" /></button>
          <button onClick={onRequestSave} className="fm-btn fm-btn-primary" title="Save map"><Save className="w-3.5 h-3.5" /> Save</button>
        </div>
      </div>

      {draft && (
        <div className="absolute top-12 left-1/2 -translate-x-1/2 z-30 bg-popover border border-border/50 rounded-full px-3 py-1 text-xs shadow-lg flex items-center gap-2">
          <span>Click to add points · double-click or Enter to finish · Esc to cancel</span>
          <button className="fm-btn fm-btn-sm" onClick={commitDraft}>Finish</button>
        </div>
      )}

      {/* Body */}
      <div className="flex-1 min-h-0 flex relative">
        {/* Left library */}
        {leftOpen && (
          <div className={isMobile ? 'absolute z-40 left-0 top-0 bottom-0 w-64 shadow-2xl' : 'w-60 shrink-0 border-r border-border/30'}>
            <LibraryPanel
              active={picked} imports={doc.imports}
              onPick={(p) => { setPicked(p); if (p) setTool('stamp'); else setTool('select'); }}
              onImport={importIcons} onImportBackground={importBackground}
            />
          </div>
        )}

        {/* Canvas */}
        <div ref={wrapRef} className="flex-1 min-h-0 relative fm-canvas-wrap" onContextMenu={(e) => e.preventDefault()}>
          <Stage
            ref={stageRef}
            width={size.w}
            height={size.h}
            onWheel={onWheel}
            onMouseDown={onStageMouseDown}
            onTap={onStageMouseDown as unknown as (e: KonvaEventObject<Event>) => void}
            onDblClick={onStageDblClick}
            onDblTap={onStageDblClick}
            onContextMenu={onStageContextMenu}
            style={{ cursor: tool === 'pan' ? 'grab' : tool === 'stamp' ? 'copy' : 'default' }}
          >
            <Layer
              x={view.x} y={view.y} scaleX={view.scale} scaleY={view.scale}
              draggable={layerDraggable}
              onDragEnd={(e) => { if (e.target.getClassName() === 'Layer') setView((v) => ({ ...v, x: e.target.x(), y: e.target.y() })); }}
            >
              {/* Page / background */}
              <Rect name="bg" x={0} y={0} width={W} height={H} fill={bgFill}
                stroke="#0000001a" strokeWidth={1 / view.scale} shadowColor="#000" shadowBlur={16} shadowOpacity={0.18} />

              {/* Terrain */}
              {lm.terrain.visible && terrainCanvas && (
                <KonvaImage image={terrainCanvas} x={0} y={0} width={W} height={H} listening={false} imageSmoothingEnabled />
              )}
              {lm.terrain.visible && terrainImg && (
                <KonvaImage image={terrainImg} x={0} y={0} width={W} height={H} listening={false} />
              )}

              {/* Grid */}
              {doc.grid.type !== 'none' && (
                <GridLayer type={doc.grid.type} W={W} H={H} size={doc.grid.size} color={doc.grid.color} opacity={doc.grid.opacity} scale={view.scale} />
              )}

              {/* Regions */}
              {lm.regions.visible && sortedRegions.map((r) => (
                <RegionShape key={r.id} region={r} selected={selection?.id === r.id}
                  selectable={selectable && !lm.regions.locked && !r.locked}
                  onSelect={() => setSelection({ type: 'region', id: r.id })}
                  onDragStart={onObjDragStart}
                  onMoved={(pts) => patchObject('region', r.id, { points: pts }, false)} />
              ))}

              {/* Routes */}
              {lm.routes.visible && sortedRoutes.map((r) => (
                <RouteShape key={r.id} route={r} selected={selection?.id === r.id}
                  selectable={selectable && !lm.routes.locked && !r.locked}
                  onSelect={() => setSelection({ type: 'route', id: r.id })}
                  onDragStart={onObjDragStart}
                  onMoved={(pts) => patchObject('route', r.id, { points: pts }, false)} />
              ))}

              {/* Region labels */}
              {lm.regions.visible && sortedRegions.map((r) => r.labelPos && (
                <Text key={r.id + '_t'} text={r.name} x={r.labelPos.x} y={r.labelPos.y} fontSize={18} fontStyle="bold"
                  fill="#2b2317" align="center" offsetX={r.name.length * 4.5} listening={false} opacity={0.85} />
              ))}

              {/* Items */}
              {lm.items.visible && sortedItems.map((it) => (
                <ItemNode key={it.id} item={it} selectable={selectable && !lm.items.locked && !it.locked}
                  onSelect={() => setSelection({ type: 'item', id: it.id })}
                  onDragStart={onObjDragStart}
                  onChange={(patch) => patchObject('item', it.id, patch, false)}
                  snap={snap} />
              ))}

              {/* Item captions */}
              {lm.items.visible && sortedItems.map((it) => it.label && (
                <Text key={it.id + '_c'} text={it.label} x={it.x} y={it.y + (it.height * it.scale) / 2 + 2}
                  fontSize={13} fontStyle="bold" fill="#2b2317" align="center" offsetX={it.label.length * 3.2} listening={false} />
              ))}

              {/* Labels */}
              {lm.labels.visible && doc.labels.map((l) => (
                <Text key={l.id} id={l.id} text={l.text} x={l.x} y={l.y} fontSize={l.size} rotation={l.rotation}
                  fill={l.color} fontStyle={l.bold ? 'bold' : 'normal'} draggable={selectable && !lm.labels.locked && !l.locked}
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

              {/* In-progress draft */}
              {draft && (
                <Line points={draft.points} stroke="#2563eb" strokeWidth={2 / view.scale} dash={[8 / view.scale, 6 / view.scale]}
                  closed={draft.kind === 'region'} fill={draft.kind === 'region' ? '#2563eb22' : undefined} listening={false} />
              )}

              <Transformer ref={trRef} rotateEnabled keepRatio
                anchorSize={9} borderStroke="#2563eb" anchorStroke="#2563eb"
                boundBoxFunc={(oldB, newB) => (newB.width < 8 || newB.height < 8 ? oldB : newB)} />
            </Layer>
          </Stage>

          {/* Empty hint */}
          {doc.terrain.mode === 'none' && doc.items.length === 0 && doc.regions.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="text-center text-muted-foreground/60 max-w-xs">
                <Wand2 className="w-8 h-8 mx-auto mb-3 opacity-50" />
                <p className="text-sm font-medium mb-1">{kindDef.title}</p>
                <p className="text-xs leading-relaxed">Hit <b>Generate</b> for an instant world, or pick an icon from the library and start placing things by hand.</p>
              </div>
            </div>
          )}
        </div>

        {/* Right inspector */}
        {rightOpen && (
          <div className={isMobile ? 'absolute z-40 right-0 top-0 bottom-0 w-64 shadow-2xl' : 'w-60 shrink-0 border-l border-border/30'}>
            <InspectorPanel
              doc={doc} selection={selection}
              onPatchObject={(t, id, p) => patchObject(t, id, p)}
              onDeleteObject={deleteObject}
              onPatchCanvas={onPatchCanvas} onPatchBackground={onPatchBackground} onPatchGrid={onPatchGrid}
              onToggleLayer={onToggleLayer} onChangeKind={onChangeKind} onExport={exportPng}
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
                    <CtxItem icon={Copy} label="Copy" onSelect={() => { const it = doc.items.find((i) => i.id === ctxMenu.sel!.id); if (it) clipboard.current = it; setCtxMenu(null); }} />
                    <CtxItem icon={Copy} label="Duplicate" onSelect={() => { const it = doc.items.find((i) => i.id === ctxMenu.sel!.id); if (it) { const n = { ...it, id: mapId('it'), x: it.x + 24, y: it.y + 24, z: nextZ(doc.items) }; mutate((d) => ({ ...d, items: [...d.items, n] })); setSelection({ type: 'item', id: n.id }); } setCtxMenu(null); }} />
                  </>
                )}
                <CtxItem icon={ArrowUpToLine} label="Bring to front" onSelect={() => reorder(ctxMenu.sel!.type, ctxMenu.sel!.id, true)} />
                <CtxItem icon={ArrowDownToLine} label="Send to back" onSelect={() => reorder(ctxMenu.sel!.type, ctxMenu.sel!.id, false)} />
                <CtxItem icon={Lock} label="Lock / unlock" onSelect={() => { const t = ctxMenu.sel!.type; const arr = doc[`${t}s` as 'items'] as Array<{ id: string; locked?: boolean }>; const o = arr.find((x) => x.id === ctxMenu.sel!.id); patchObject(t, ctxMenu.sel!.id, { locked: !o?.locked }, false); setCtxMenu(null); }} />
                <div className="h-px bg-border/40 my-1" />
                <CtxItem icon={Trash2} label="Delete" danger onSelect={() => deleteObject(ctxMenu.sel!.type, ctxMenu.sel!.id)} />
              </>
            ) : clipboard.current ? (
              <CtxItem icon={ClipboardPaste} label="Paste here" onSelect={() => { const m = { x: (ctxMenu.x - (wrapRef.current?.getBoundingClientRect().left ?? 0) - view.x) / view.scale, y: (ctxMenu.y - (wrapRef.current?.getBoundingClientRect().top ?? 0) - view.y) / view.scale }; const src = clipboard.current!; const n: MapItem = { ...src, id: mapId('it'), x: m.x, y: m.y, z: nextZ(doc.items) }; mutate((d) => ({ ...d, items: [...d.items, n] })); setSelection({ type: 'item', id: n.id }); setCtxMenu(null); }} />
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

/* ── Konva sub-nodes (each needs its own image hook) ─────────────────────── */

function ItemNode({ item, selectable, onSelect, onDragStart, onChange, snap }: {
  item: MapItem; selectable: boolean; onSelect: () => void; onDragStart: () => void;
  onChange: (patch: Partial<MapItem>) => void; snap: (n: number) => number;
}) {
  const img = useImage(toItemUrl(item));
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

function RegionShape({ region, selected, selectable, onSelect, onDragStart, onMoved }: {
  region: MapRegion; selected: boolean; selectable: boolean; onSelect: () => void; onDragStart: () => void; onMoved: (pts: number[]) => void;
}) {
  return (
    <Line
      points={region.points}
      closed
      fill={region.fill}
      opacity={region.opacity}
      stroke={selected ? '#2563eb' : region.stroke}
      strokeWidth={selected ? 3 : 1.5}
      draggable={selectable}
      onMouseDown={(e) => { if (selectable) { e.cancelBubble = true; onSelect(); } }}
      onClick={(e) => { if (selectable) { e.cancelBubble = true; onSelect(); } }}
      onTap={(e) => { if (selectable) { e.cancelBubble = true; onSelect(); } }}
      onDragStart={onDragStart}
      onDragEnd={(e) => { const dx = e.target.x(); const dy = e.target.y(); e.target.position({ x: 0, y: 0 }); onMoved(shiftPoints(region.points, dx, dy)); }}
    />
  );
}

function RouteShape({ route, selected, selectable, onSelect, onDragStart, onMoved }: {
  route: MapRoute; selected: boolean; selectable: boolean; onSelect: () => void; onDragStart: () => void; onMoved: (pts: number[]) => void;
}) {
  return (
    <Line
      points={route.points}
      stroke={selected ? '#2563eb' : route.color}
      strokeWidth={route.width}
      dash={route.dashed ? [route.width * 2, route.width * 1.5] : undefined}
      lineCap="round"
      lineJoin="round"
      tension={route.kind === 'river' ? 0.4 : 0}
      hitStrokeWidth={Math.max(12, route.width + 8)}
      draggable={selectable}
      onMouseDown={(e) => { if (selectable) { e.cancelBubble = true; onSelect(); } }}
      onClick={(e) => { if (selectable) { e.cancelBubble = true; onSelect(); } }}
      onTap={(e) => { if (selectable) { e.cancelBubble = true; onSelect(); } }}
      onDragStart={onDragStart}
      onDragEnd={(e) => { const dx = e.target.x(); const dy = e.target.y(); e.target.position({ x: 0, y: 0 }); onMoved(shiftPoints(route.points, dx, dy)); }}
    />
  );
}

function GridLayer({ type, W, H, size, color, opacity, scale }: {
  type: 'square' | 'hex'; W: number; H: number; size: number; color: string; opacity: number; scale: number;
}) {
  if (type === 'square') {
    const lines: number[][] = [];
    for (let x = 0; x <= W; x += size) lines.push([x, 0, x, H]);
    for (let y = 0; y <= H; y += size) lines.push([0, y, W, y]);
    return (
      <>
        {lines.map((pts, i) => (
          <Line key={i} points={pts} stroke={color} strokeWidth={1 / scale} opacity={opacity} listening={false} />
        ))}
      </>
    );
  }
  // hex (pointy-top)
  return (
    <Shape
      listening={false}
      opacity={opacity}
      stroke={color}
      strokeWidth={1 / scale}
      sceneFunc={(ctx, shape) => {
        const r = size / 2;
        const hw = Math.sqrt(3) * r;
        ctx.beginPath();
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
