import type { ThemeType } from '../../App';
import { Check } from 'lucide-react';

interface Props {
  theme: ThemeType;
  setTheme: (t: ThemeType) => void;
  editorFont: string;
  setEditorFont: (f: string) => void;
  editorSize: number;
  setEditorSize: (n: number) => void;
  lineHeight: number;
  setLineHeight: (n: number) => void;
  spellcheckActive: boolean;
  setSpellcheckActive: (b: boolean) => void;
  autoSaveInterval: number;
  setAutoSaveInterval: (n: number) => void;
}

const THEMES: { id: ThemeType; label: string; bg: string; accent: string }[] = [
  { id: 'dark', label: 'Midnight', bg: '#0e1116', accent: '#8aa0ff' },
  { id: 'light', label: 'Parchment', bg: '#faf8f3', accent: '#4f46e5' },
  { id: 'glass', label: 'Nebula', bg: '#141020', accent: '#b292ff' },
  { id: 'ocean', label: 'Ocean', bg: '#0a1626', accent: '#38bdf8' },
  { id: 'forest', label: 'Forest', bg: '#0b1c14', accent: '#34d399' },
  { id: 'sunset', label: 'Sunset', bg: '#1e1210', accent: '#fb7a5c' },
];

const FONTS = [
  { value: 'Inter', label: 'Inter — clean sans' },
  { value: 'Georgia', label: 'Georgia — serif' },
  { value: "'Times New Roman', serif", label: 'Times — manuscript' },
  { value: "'Courier New', monospace", label: 'Courier — typewriter' },
];

const label = 'text-3xs font-semibold tracking-[0.12em] text-muted-foreground/70 uppercase';

/** Full-screen mobile settings — visual theme swatches + typography + writing. */
function MobileSettings({
  theme,
  setTheme,
  editorFont,
  setEditorFont,
  editorSize,
  setEditorSize,
  lineHeight,
  setLineHeight,
  spellcheckActive,
  setSpellcheckActive,
  autoSaveInterval,
  setAutoSaveInterval,
}: Props) {
  return (
    <div className="flex-1 overflow-y-auto px-4 py-5 flex flex-col gap-7 pb-10">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>

      {/* Theme */}
      <section className="flex flex-col gap-3">
        <h2 className={label}>Theme</h2>
        <div className="grid grid-cols-2 gap-2.5">
          {THEMES.map((t) => (
            <button
              key={t.id}
              onClick={() => setTheme(t.id)}
              className={`relative flex items-center gap-3 p-3 rounded-2xl border transition-all active:scale-[0.98] ${
                theme === t.id ? 'border-primary ring-1 ring-primary/40' : 'border-border/40'
              }`}
              style={{ background: 'color-mix(in srgb, var(--card) 70%, transparent)' }}
            >
              <span className="w-9 h-9 rounded-xl border border-white/10 shrink-0 flex items-center justify-center" style={{ background: t.bg }}>
                <span className="w-4 h-4 rounded-full" style={{ background: t.accent }} />
              </span>
              <span className="text-sm font-medium">{t.label}</span>
              {theme === t.id && <Check className="w-4 h-4 text-primary absolute top-2 right-2" />}
            </button>
          ))}
        </div>
      </section>

      {/* Typography */}
      <section className="flex flex-col gap-4">
        <h2 className={label}>Typography</h2>

        <div className="flex flex-col gap-2">
          <span className="text-sm text-foreground/80">Font</span>
          <div className="flex flex-col gap-2">
            {FONTS.map((f) => (
              <button
                key={f.value}
                onClick={() => setEditorFont(f.value)}
                className={`mn-row justify-between ${editorFont === f.value ? 'border-primary' : ''}`}
              >
                <span className="text-sm" style={{ fontFamily: f.value }}>{f.label}</span>
                {editorFont === f.value && <Check className="w-4 h-4 text-primary" />}
              </button>
            ))}
          </div>
        </div>

        <Slider title="Text size" value={editorSize} min={12} max={26} step={1} suffix="px" onChange={setEditorSize} />
        <Slider title="Line spacing" value={lineHeight} min={1} max={2.5} step={0.1} suffix="×" onChange={setLineHeight} fixed={1} />
      </section>

      {/* Writing */}
      <section className="flex flex-col gap-3">
        <h2 className={label}>Writing</h2>
        <label className="mn-row justify-between">
          <span className="text-sm">Spellcheck highlighting</span>
          <input
            type="checkbox"
            className="w-5 h-5 rounded accent-primary"
            checked={spellcheckActive}
            onChange={(e) => setSpellcheckActive(e.target.checked)}
          />
        </label>
        <div className="mn-row justify-between">
          <span className="text-sm">Auto-save every</span>
          <select
            className="bg-secondary/40 border border-border/40 rounded-lg px-3 py-1.5 text-sm outline-none"
            value={autoSaveInterval}
            onChange={(e) => setAutoSaveInterval(parseInt(e.target.value))}
          >
            <option value={15}>15s</option>
            <option value={30}>30s</option>
            <option value={60}>60s</option>
          </select>
        </div>
      </section>

      <p className="text-3xs text-muted-foreground/50 text-center pt-2">MnemoScript · local-first writing studio</p>
    </div>
  );
}

function Slider({
  title,
  value,
  min,
  max,
  step,
  suffix,
  onChange,
  fixed,
}: {
  title: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix: string;
  onChange: (n: number) => void;
  fixed?: number;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex justify-between text-sm text-foreground/80">
        <span>{title}</span>
        <span className="font-mono text-primary">{fixed != null ? value.toFixed(fixed) : value}{suffix}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full accent-primary h-2 bg-secondary rounded-lg"
      />
    </div>
  );
}

export default MobileSettings;
