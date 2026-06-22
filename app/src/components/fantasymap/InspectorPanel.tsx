import {
  Trash2, FlipHorizontal2, Lock, Unlock, Eye, EyeOff, Download, MapIcon,
} from 'lucide-react';
import type {
  FantasyMapDoc, LayerId, MapItem, MapRegion, MapRoute, MapLabel, MapKind, MapStyle, MapDecor, RegionLevel,
} from './mapTypes';
import { MAP_KINDS, REGION_LEVELS } from './mapTypes';

export type SelType = 'item' | 'region' | 'route' | 'label';
export interface Selection { type: SelType; id: string; }

interface Props {
  doc: FantasyMapDoc;
  selection: Selection | null;
  onPatchObject: (type: SelType, id: string, patch: Record<string, unknown>) => void;
  onDeleteObject: (type: SelType, id: string) => void;
  onPatchCanvas: (patch: Partial<FantasyMapDoc['canvas']>) => void;
  onPatchBackground: (patch: Partial<FantasyMapDoc['canvas']['background']>) => void;
  onPatchGrid: (patch: Partial<FantasyMapDoc['grid']>) => void;
  onResizeCanvas: (w: number, h: number) => void;
  onSetRuggedness: (v: number) => void;
  onToggleLayer: (layer: LayerId, key: 'visible' | 'locked') => void;
  onChangeKind: (kind: MapKind) => void;
  onChangeStyle: (style: MapStyle) => void;
  onToggleDecor: (key: keyof MapDecor) => void;
  onExport: () => void;
}

const SIZES: { label: string; w: number; h: number }[] = [
  { label: 'Region · 1400×1000', w: 1400, h: 1000 },
  { label: 'HD · 1920×1200', w: 1920, h: 1200 },
  { label: '2K · 2560×1600', w: 2560, h: 1600 },
  { label: '4K · 3840×2400', w: 3840, h: 2400 },
];

const LAYERS: { id: LayerId; label: string }[] = [
  { id: 'terrain', label: 'Terrain' },
  { id: 'regions', label: 'Regions' },
  { id: 'routes', label: 'Routes' },
  { id: 'items', label: 'Icons' },
  { id: 'labels', label: 'Labels' },
];

export default function InspectorPanel(props: Props) {
  const { doc, selection } = props;
  const obj = selection
    ? (doc[`${selection.type}s` as 'items' | 'regions' | 'routes' | 'labels'] as Array<{ id: string }>)
        .find((o) => o.id === selection.id)
    : null;

  return (
    <div className="fm-panel flex flex-col h-full overflow-y-auto">
      <div className="fm-panel-head">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {selection ? 'Selected' : 'Map'}
        </span>
        <button className="fm-btn fm-btn-sm" onClick={props.onExport} title="Export as PNG">
          <Download className="w-3.5 h-3.5" /> PNG
        </button>
      </div>

      {selection && obj ? (
        <div className="px-3 py-2 border-b border-border/30">
          {selection.type === 'item' && <ItemEditor item={obj as MapItem} {...props} />}
          {selection.type === 'region' && <RegionEditor region={obj as MapRegion} {...props} />}
          {selection.type === 'route' && <RouteEditor route={obj as MapRoute} {...props} />}
          {selection.type === 'label' && <LabelEditor label={obj as MapLabel} {...props} />}
          <button
            className="fm-btn fm-btn-danger w-full mt-2"
            onClick={() => props.onDeleteObject(selection.type, selection.id)}
          >
            <Trash2 className="w-3.5 h-3.5" /> Delete
          </button>
        </div>
      ) : (
        <div className="px-3 py-2 text-[11px] text-muted-foreground/70 border-b border-border/30">
          Select an object to edit it, or set up the map below.
        </div>
      )}

      {/* Map settings */}
      <div className="px-3 py-2 border-b border-border/30">
        <SectionTitle icon={<MapIcon className="w-3.5 h-3.5" />}>Map</SectionTitle>
        <Row label="Type">
          <select
            className="fm-input"
            value={doc.kind}
            onChange={(e) => props.onChangeKind(e.target.value as MapKind)}
          >
            {MAP_KINDS.map((k) => <option key={k.id} value={k.id}>{k.title}</option>)}
          </select>
        </Row>
        <Row label="Art style">
          <select
            className="fm-input"
            value={doc.style}
            onChange={(e) => props.onChangeStyle(e.target.value as MapStyle)}
          >
            <option value="handdrawn">Hand-drawn (ink)</option>
            <option value="classic">Classic (colour)</option>
          </select>
        </Row>
        {doc.style === 'handdrawn' && (
          <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1 mb-1.5">
            <DecorToggle label="Frame" on={doc.decor.frame} onClick={() => props.onToggleDecor('frame')} />
            <DecorToggle label="Compass" on={doc.decor.compass} onClick={() => props.onToggleDecor('compass')} />
            <DecorToggle label="Title" on={doc.decor.cartouche} onClick={() => props.onToggleDecor('cartouche')} />
          </div>
        )}
        <SliderRow label="Ruggedness · smooth → rugged" min={0} max={1} step={0.02}
          value={doc.terrain.ruggedness ?? 0.35}
          onChange={(v) => props.onSetRuggedness(v)} fmt={(v) => `${Math.round(v * 100)}%`} />
        <Row label="Size">
          <select
            className="fm-input"
            value={`${doc.canvas.width}×${doc.canvas.height}`}
            onChange={(e) => {
              const s = SIZES.find((o) => `${o.w}×${o.h}` === e.target.value);
              if (s) props.onResizeCanvas(s.w, s.h);
            }}
          >
            {!SIZES.some((s) => `${s.w}×${s.h}` === `${doc.canvas.width}×${doc.canvas.height}`) && (
              <option value={`${doc.canvas.width}×${doc.canvas.height}`}>
                Custom · {doc.canvas.width}×{doc.canvas.height}
              </option>
            )}
            {SIZES.map((s) => <option key={s.label} value={`${s.w}×${s.h}`}>{s.label}</option>)}
          </select>
        </Row>
        <Row label="Background">
          <select
            className="fm-input"
            value={doc.canvas.background.type}
            onChange={(e) => props.onPatchBackground({ type: e.target.value as 'color' | 'parchment' })}
          >
            <option value="parchment">Parchment</option>
            <option value="color">Solid colour</option>
          </select>
        </Row>
        {doc.canvas.background.type !== 'image' && (
          <Row label="Colour">
            <input
              type="color"
              className="fm-color"
              value={doc.canvas.background.value}
              onChange={(e) => props.onPatchBackground({ value: e.target.value })}
            />
          </Row>
        )}
      </div>

      {/* Grid */}
      <div className="px-3 py-2 border-b border-border/30">
        <SectionTitle>Grid</SectionTitle>
        <Row label="Style">
          <select
            className="fm-input"
            value={doc.grid.type}
            onChange={(e) => props.onPatchGrid({ type: e.target.value as 'none' | 'square' | 'hex' })}
          >
            <option value="none">None</option>
            <option value="square">Square</option>
            <option value="hex">Hex</option>
          </select>
        </Row>
        {doc.grid.type !== 'none' && (
          <>
            <SliderRow label="Size" min={24} max={160} step={2} value={doc.grid.size}
              onChange={(v) => props.onPatchGrid({ size: v })} fmt={(v) => `${v}px`} />
            <label className="flex items-center gap-1.5 text-[11px] mt-1 cursor-pointer">
              <input type="checkbox" checked={doc.grid.snap}
                onChange={(e) => props.onPatchGrid({ snap: e.target.checked })} />
              Snap icons to grid
            </label>
          </>
        )}
      </div>

      {/* Layers */}
      <div className="px-3 py-2">
        <SectionTitle>Layers</SectionTitle>
        {LAYERS.map((l) => {
          const m = doc.layersMeta[l.id];
          return (
            <div key={l.id} className="flex items-center justify-between py-0.5">
              <span className="text-[11px]">{l.label}</span>
              <div className="flex items-center gap-1">
                <button className="fm-iconbtn" title={m.visible ? 'Hide' : 'Show'}
                  onClick={() => props.onToggleLayer(l.id, 'visible')}>
                  {m.visible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5 opacity-50" />}
                </button>
                <button className="fm-iconbtn" title={m.locked ? 'Unlock' : 'Lock'}
                  onClick={() => props.onToggleLayer(l.id, 'locked')}>
                  {m.locked ? <Lock className="w-3.5 h-3.5 text-amber-500" /> : <Unlock className="w-3.5 h-3.5 opacity-60" />}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── per-type editors ───────────────────────────────────────────────────── */

function ItemEditor({ item, onPatchObject }: { item: MapItem } & Props) {
  const patch = (p: Partial<MapItem>) => onPatchObject('item', item.id, p);
  return (
    <>
      <Row label="Label">
        <input className="fm-input" value={item.label ?? ''} placeholder="(none)"
          onChange={(e) => patch({ label: e.target.value })} />
      </Row>
      <SliderRow label="Size" min={0.2} max={4} step={0.05} value={item.scale}
        onChange={(v) => patch({ scale: v })} fmt={(v) => `${Math.round(v * 100)}%`} />
      <SliderRow label="Rotation" min={-180} max={180} step={1} value={item.rotation}
        onChange={(v) => patch({ rotation: v })} fmt={(v) => `${v}°`} />
      {item.libId && (
        <Row label="Colour">
          <input type="color" className="fm-color" value={item.tint ?? '#3a2f23'}
            onChange={(e) => patch({ tint: e.target.value })} />
        </Row>
      )}
      <div className="flex gap-1.5 mt-1.5">
        <button className={`fm-btn fm-btn-sm flex-1 ${item.flipX ? 'is-active' : ''}`}
          onClick={() => patch({ flipX: !item.flipX })}>
          <FlipHorizontal2 className="w-3.5 h-3.5" /> Flip
        </button>
        <button className={`fm-btn fm-btn-sm flex-1 ${item.locked ? 'is-active' : ''}`}
          onClick={() => patch({ locked: !item.locked })}>
          {item.locked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />} Lock
        </button>
      </div>
    </>
  );
}

function RegionEditor({ region, doc, onPatchObject }: { region: MapRegion } & Props) {
  const patch = (p: Partial<MapRegion>) => onPatchObject('region', region.id, p);
  const others = doc.regions.filter((r) => r.id !== region.id);
  return (
    <>
      <Row label="Name">
        <input className="fm-input" value={region.name}
          onChange={(e) => patch({ name: e.target.value })} />
      </Row>
      <Row label="Tier">
        <select className="fm-input" value={region.level ?? 'realm'}
          onChange={(e) => patch({ level: e.target.value as RegionLevel })}>
          {REGION_LEVELS.map((l) => <option key={l.id} value={l.id}>{l.title}</option>)}
        </select>
      </Row>
      <Row label="Within">
        <select className="fm-input" value={region.parentId ?? ''}
          onChange={(e) => patch({ parentId: e.target.value || undefined })}>
          <option value="">— None —</option>
          {others.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
      </Row>
      <Row label="Border"><input type="color" className="fm-color" value={region.stroke}
        onChange={(e) => patch({ stroke: e.target.value })} /></Row>
      <label className="flex items-center gap-1.5 text-[11px] mt-1 cursor-pointer">
        <input type="checkbox" checked={!!region.showFill}
          onChange={(e) => patch({ showFill: e.target.checked })} />
        Fill the area (off = border only)
      </label>
      {region.showFill && (
        <>
          <Row label="Fill"><input type="color" className="fm-color" value={region.fill}
            onChange={(e) => patch({ fill: e.target.value })} /></Row>
          <SliderRow label="Opacity" min={0.02} max={0.6} step={0.02} value={region.opacity}
            onChange={(v) => patch({ opacity: v })} fmt={(v) => `${Math.round(v * 100)}%`} />
        </>
      )}
      <p className="text-[10px] text-muted-foreground/70 mt-1.5 leading-snug">
        Tip: select the <b>Region</b> tool and draw from this region’s edge to extend it.
      </p>
    </>
  );
}

function RouteEditor({ route, onPatchObject }: { route: MapRoute } & Props) {
  const patch = (p: Partial<MapRoute>) => onPatchObject('route', route.id, p);
  return (
    <>
      <Row label="Type">
        <select className="fm-input" value={route.kind}
          onChange={(e) => patch({ kind: e.target.value as MapRoute['kind'] })}>
          <option value="road">Road</option>
          <option value="river">River</option>
          <option value="border">Border</option>
        </select>
      </Row>
      <Row label="Colour"><input type="color" className="fm-color" value={route.color}
        onChange={(e) => patch({ color: e.target.value })} /></Row>
      <SliderRow label="Width" min={1} max={16} step={1} value={route.width}
        onChange={(v) => patch({ width: v })} fmt={(v) => `${v}px`} />
      <label className="flex items-center gap-1.5 text-[11px] mt-1 cursor-pointer">
        <input type="checkbox" checked={!!route.dashed}
          onChange={(e) => patch({ dashed: e.target.checked })} />
        Dashed
      </label>
    </>
  );
}

function LabelEditor({ label, onPatchObject }: { label: MapLabel } & Props) {
  const patch = (p: Partial<MapLabel>) => onPatchObject('label', label.id, p);
  return (
    <>
      <Row label="Text">
        <input className="fm-input" value={label.text}
          onChange={(e) => patch({ text: e.target.value })} />
      </Row>
      <SliderRow label="Size" min={8} max={72} step={1} value={label.size}
        onChange={(v) => patch({ size: v })} fmt={(v) => `${v}px`} />
      <SliderRow label="Rotation" min={-90} max={90} step={1} value={label.rotation}
        onChange={(v) => patch({ rotation: v })} fmt={(v) => `${v}°`} />
      <Row label="Colour"><input type="color" className="fm-color" value={label.color}
        onChange={(e) => patch({ color: e.target.value })} /></Row>
      <label className="flex items-center gap-1.5 text-[11px] mt-1 cursor-pointer">
        <input type="checkbox" checked={!!label.bold}
          onChange={(e) => patch({ bold: e.target.checked })} />
        Bold
      </label>
    </>
  );
}

function DecorToggle({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
    <label className="flex items-center gap-1.5 text-[11px] cursor-pointer">
      <input type="checkbox" checked={on} onChange={onClick} />
      {label}
    </label>
  );
}

/* ── tiny layout helpers ────────────────────────────────────────────────── */
function SectionTitle({ children, icon }: { children: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground mb-1.5">
      {icon}{children}
    </div>
  );
}
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 mb-1.5">
      <span className="text-[11px] text-muted-foreground shrink-0">{label}</span>
      <div className="flex-1 flex justify-end">{children}</div>
    </div>
  );
}
function SliderRow({ label, min, max, step, value, onChange, fmt }: {
  label: string; min: number; max: number; step: number; value: number;
  onChange: (v: number) => void; fmt: (v: number) => string;
}) {
  return (
    <div className="mb-1.5">
      <div className="flex items-center justify-between text-[11px] text-muted-foreground mb-0.5">
        <span>{label}</span><span className="tabular-nums text-foreground/80">{fmt(value)}</span>
      </div>
      <input className="fm-range w-full" type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  );
}
