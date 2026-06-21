import { Dice5, Wand2, RefreshCw, Eraser, X } from 'lucide-react';
import type { GenParams, GenShape, BiomePreset, MapStyle } from './mapTypes';

interface Props {
  params: GenParams;
  onChange: (p: GenParams) => void;
  onGenerate: () => void;
  onRegenerate: () => void;
  onRandomize: () => void;
  onClear: () => void;
  onClose: () => void;
}

const STYLES: { id: MapStyle; label: string }[] = [
  { id: 'handdrawn', label: 'Hand-drawn' },
  { id: 'classic', label: 'Classic' },
];

const SHAPES: { id: GenShape; label: string }[] = [
  { id: 'continent', label: 'Continent' },
  { id: 'island', label: 'Island' },
  { id: 'archipelago', label: 'Archipelago' },
];

const PRESETS: { id: BiomePreset; label: string }[] = [
  { id: 'temperate', label: 'Temperate' },
  { id: 'arid', label: 'Arid' },
  { id: 'arctic', label: 'Arctic' },
  { id: 'volcanic', label: 'Volcanic' },
  { id: 'verdant', label: 'Verdant' },
];

export default function GeneratePanel({
  params, onChange, onGenerate, onRegenerate, onRandomize, onClear, onClose,
}: Props) {
  const set = <K extends keyof GenParams>(key: K, value: GenParams[K]) =>
    onChange({ ...params, [key]: value });

  return (
    <div className="fm-genpanel" onPointerDown={(e) => e.stopPropagation()}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-semibold flex items-center gap-1.5">
          <Wand2 className="w-4 h-4 text-primary" /> Auto-generate map
        </span>
        <button className="fm-iconbtn" title="Close" onClick={onClose}>
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Engine style */}
      <Field label="Art style">
        <div className="flex gap-1">
          {STYLES.map((s) => (
            <button
              key={s.id}
              onClick={() => set('style', s.id)}
              className={`fm-seg ${params.style === s.id ? 'is-active' : ''}`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </Field>

      {/* Shape */}
      <Field label="Landmass shape">
        <div className="flex gap-1">
          {SHAPES.map((s) => (
            <button
              key={s.id}
              onClick={() => set('shape', s.id)}
              className={`fm-seg ${params.shape === s.id ? 'is-active' : ''}`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </Field>

      {/* Numbers the user sets directly */}
      <NumberField
        label="Regions" hint="named areas"
        min={0} max={60} value={params.regionCount}
        onChange={(v) => set('regionCount', v)}
      />
      <NumberField
        label="Biomes" hint="terrain bands"
        min={2} max={10} value={params.biomeCount}
        onChange={(v) => set('biomeCount', v)}
      />

      <SliderField
        label="Land amount" min={0.1} max={0.92} step={0.01}
        value={params.landAmount} fmt={(v) => `${Math.round(v * 100)}%`}
        onChange={(v) => set('landAmount', v)}
      />
      <SliderField
        label="Coastline detail" min={1} max={6} step={1}
        value={params.roughness} fmt={(v) => String(v)}
        onChange={(v) => set('roughness', v)}
      />
      <SliderField
        label="Icon scatter" min={0} max={1} step={0.05}
        value={params.scatterDensity} fmt={(v) => `${Math.round(v * 100)}%`}
        onChange={(v) => set('scatterDensity', v)}
      />

      <Field label="Biome preset">
        <select
          className="fm-input"
          value={params.biomePreset}
          onChange={(e) => set('biomePreset', e.target.value as BiomePreset)}
        >
          {PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
      </Field>

      <div className="flex gap-3 my-1.5 text-xs">
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input type="checkbox" checked={params.scatterTerrain}
            onChange={(e) => set('scatterTerrain', e.target.checked)} />
          Terrain icons
        </label>
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input type="checkbox" checked={params.scatterSettlements}
            onChange={(e) => set('scatterSettlements', e.target.checked)} />
          Settlements
        </label>
      </div>

      <Field label="Seed">
        <input
          className="fm-input"
          type="number"
          value={params.seed}
          onChange={(e) => set('seed', Number(e.target.value) || 0)}
        />
      </Field>

      <div className="grid grid-cols-2 gap-1.5 mt-3">
        <button className="fm-btn fm-btn-primary col-span-2" onClick={onGenerate}>
          <Wand2 className="w-4 h-4" /> Generate
        </button>
        <button className="fm-btn" onClick={onRegenerate} title="New seed, same settings">
          <RefreshCw className="w-3.5 h-3.5" /> Regenerate
        </button>
        <button className="fm-btn" onClick={onRandomize} title="Randomise everything">
          <Dice5 className="w-3.5 h-3.5" /> Randomize
        </button>
        <button className="fm-btn fm-btn-danger col-span-2" onClick={onClear}>
          <Eraser className="w-3.5 h-3.5" /> Clear generated terrain
        </button>
      </div>
      <p className="text-[10px] text-muted-foreground/70 mt-2 leading-snug">
        Generating replaces the terrain, regions &amp; scattered icons. Everything stays
        fully editable afterwards — move, rename, add or delete by hand.
      </p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-2">
      <div className="text-[11px] font-medium text-muted-foreground mb-1">{label}</div>
      {children}
    </div>
  );
}

function NumberField({ label, hint, min, max, value, onChange }: {
  label: string; hint?: string; min: number; max: number; value: number; onChange: (v: number) => void;
}) {
  const clamp = (v: number) => Math.max(min, Math.min(max, Math.round(v)));
  return (
    <div className="mb-2 flex items-center justify-between gap-2">
      <div className="text-[11px] font-medium text-muted-foreground">
        {label}{hint && <span className="text-muted-foreground/60"> · {hint}</span>}
      </div>
      <div className="flex items-center gap-1">
        <button className="fm-step" onClick={() => onChange(clamp(value - 1))}>−</button>
        <input
          className="fm-input w-14 text-center"
          type="number" min={min} max={max} value={value}
          onChange={(e) => onChange(clamp(Number(e.target.value)))}
        />
        <button className="fm-step" onClick={() => onChange(clamp(value + 1))}>+</button>
      </div>
    </div>
  );
}

function SliderField({ label, min, max, step, value, fmt, onChange }: {
  label: string; min: number; max: number; step: number; value: number;
  fmt: (v: number) => string; onChange: (v: number) => void;
}) {
  return (
    <div className="mb-2">
      <div className="flex items-center justify-between text-[11px] font-medium text-muted-foreground mb-0.5">
        <span>{label}</span>
        <span className="tabular-nums text-foreground/80">{fmt(value)}</span>
      </div>
      <input
        className="fm-range w-full"
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}
