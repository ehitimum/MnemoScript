import type { ReactNode } from 'react';
import { Check, Palette, Type, Save, FolderOpen, MousePointer2, SpellCheck } from 'lucide-react';
import type { ThemeType } from '../App';
import { THEMES, FONTS } from '../lib/prefs';
import { isTauri, isMobileOS } from '../lib/platform';

export interface SettingsProps {
  theme: ThemeType;
  setTheme: (t: ThemeType) => void;
  editorFont: string;
  setEditorFont: (f: string) => void;
  editorSize: number;
  setEditorSize: (n: number) => void;
  lineHeight: number;
  setLineHeight: (n: number) => void;
  editorPadding: number;
  setEditorPadding: (n: number) => void;
  spellcheckActive: boolean;
  setSpellcheckActive: (b: boolean) => void;
  smoothCaret: boolean;
  setSmoothCaret: (b: boolean) => void;
  autoSaveInterval: number;
  setAutoSaveInterval: (n: number) => void;
  defaultSavePath: string;
  setDefaultSavePath: (s: string) => void;
  onClose: () => void;
}

const card = 'bg-card/60 border border-border/40 rounded-2xl p-5 flex flex-col gap-4 shadow-xs';
const label = 'text-3xs font-semibold tracking-[0.12em] text-muted-foreground/70 uppercase';
const selectCls =
  'w-full bg-secondary/40 border border-border/30 text-foreground text-sm rounded-lg px-3 py-2 focus:border-primary/50 focus:ring-1 focus:ring-primary/20 outline-none cursor-pointer transition-all';

/**
 * Desktop settings screen. Lives in its own component (it used to be a branch
 * inside Editor.tsx) so the editor stays focused on writing. Every control
 * applies instantly; "Done" just returns to the document.
 */
function SettingsPanel(p: SettingsProps) {
  return (
    <div className="flex-1 flex flex-col bg-background overflow-y-auto">
      <div className="flex-1 max-w-4xl w-full mx-auto p-6 md:p-10 flex flex-col gap-8">
        <div className="flex flex-col gap-1.5">
          <h2 className="text-2xl font-semibold tracking-tight text-foreground">Settings</h2>
          <p className="text-sm text-muted-foreground">Theme, typography, writing aids, and where your work is stored.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {/* Theme */}
          <section className={`${card} md:col-span-2`}>
            <h3 className={label}><Palette className="inline w-3.5 h-3.5 mr-1.5 -mt-0.5 text-primary" />Theme</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
              {THEMES.map((t) => (
                <button
                  key={t.id}
                  onClick={() => p.setTheme(t.id)}
                  className={`relative flex items-center gap-3 p-3 rounded-xl border transition-all active:scale-[0.98] cursor-pointer ${
                    p.theme === t.id ? 'border-primary ring-1 ring-primary/40 bg-primary/5' : 'border-border/40 hover:border-border'
                  }`}
                >
                  <span className="w-9 h-9 rounded-lg border border-white/10 shrink-0 flex items-center justify-center" style={{ background: t.bg }}>
                    <span className="w-4 h-4 rounded-full" style={{ background: t.accent }} />
                  </span>
                  <span className="flex flex-col text-left leading-tight">
                    <span className="text-sm font-medium">{t.label}</span>
                    <span className="text-3xs text-muted-foreground/70">{t.hint}</span>
                  </span>
                  {p.theme === t.id && <Check className="w-4 h-4 text-primary absolute top-2.5 right-2.5" />}
                </button>
              ))}
            </div>
          </section>

          {/* Typography */}
          <section className={card}>
            <h3 className={label}><Type className="inline w-3.5 h-3.5 mr-1.5 -mt-0.5 text-primary" />Typography</h3>
            <div className="flex flex-col gap-1.5">
              <span className="text-xs text-foreground/80">Font</span>
              <select className={selectCls} value={p.editorFont} onChange={(e) => p.setEditorFont(e.target.value)}>
                {FONTS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
              </select>
            </div>
            <Slider title="Text size" value={p.editorSize} min={12} max={26} step={1} suffix="px" onChange={p.setEditorSize} />
            <Slider title="Line spacing" value={p.lineHeight} min={1} max={2.5} step={0.1} suffix="×" fixed={1} onChange={p.setLineHeight} />
            <Slider title="Page margin" value={p.editorPadding} min={10} max={120} step={5} suffix="px" onChange={p.setEditorPadding} />
          </section>

          {/* Writing */}
          <section className={card}>
            <h3 className={label}><MousePointer2 className="inline w-3.5 h-3.5 mr-1.5 -mt-0.5 text-primary" />Writing</h3>
            <Toggle
              checked={p.smoothCaret}
              onChange={p.setSmoothCaret}
              title="Smooth caret"
              hint="The cursor glides between letters as you type (Word-style)."
            />
            <Toggle
              checked={p.spellcheckActive}
              onChange={p.setSpellcheckActive}
              title="Spelling & grammar highlights"
              hint="Underlines possible mistakes and offers quick fixes."
              icon={<SpellCheck className="w-3.5 h-3.5 text-primary/80" />}
            />
            <div className="flex flex-col gap-1.5">
              <span className="text-xs text-foreground/80 flex items-center gap-1.5"><Save className="w-3.5 h-3.5 text-primary/80" /> Auto-save every</span>
              <select className={selectCls} value={p.autoSaveInterval} onChange={(e) => p.setAutoSaveInterval(parseInt(e.target.value))}>
                <option value={15}>15 seconds</option>
                <option value={30}>30 seconds</option>
                <option value={60}>60 seconds</option>
              </select>
              <p className="text-3xs text-muted-foreground/60">Changes are also saved when you switch documents or close the app.</p>
            </div>
          </section>

          {/* Storage (desktop only; mobile storage is app-private) */}
          {isTauri && !isMobileOS && (
            <section className={`${card} md:col-span-2`}>
              <h3 className={label}><FolderOpen className="inline w-3.5 h-3.5 mr-1.5 -mt-0.5 text-primary" />Storage</h3>
              <div className="flex flex-col gap-1.5">
                <span className="text-xs text-foreground/80">Default save folder for new projects</span>
                <input
                  type="text"
                  className="w-full bg-secondary/40 border border-border/30 text-foreground text-sm rounded-lg px-3 py-2 focus:border-primary/50 focus:ring-1 focus:ring-primary/20 outline-none placeholder:text-muted-foreground/50 transition-all"
                  placeholder="Leave empty to use ~/.mnemoscript/projects"
                  value={p.defaultSavePath}
                  onChange={(e) => p.setDefaultSavePath(e.target.value)}
                />
              </div>
            </section>
          )}
        </div>

        <div className="flex justify-end">
          <button
            className="bg-primary text-primary-foreground font-semibold px-5 py-2.5 rounded-lg shadow-sm hover:opacity-90 active:scale-98 cursor-pointer transition-all text-sm"
            onClick={p.onClose}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

function Toggle({ checked, onChange, title, hint, icon }: {
  checked: boolean; onChange: (b: boolean) => void; title: string; hint?: string; icon?: ReactNode;
}) {
  return (
    <label className="flex items-start gap-3 cursor-pointer group">
      <input
        type="checkbox"
        className="mt-0.5 w-4 h-4 rounded border-border accent-primary cursor-pointer"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="flex flex-col gap-0.5">
        <span className="text-xs text-foreground/90 group-hover:text-primary transition-colors flex items-center gap-1.5">{icon}{title}</span>
        {hint && <span className="text-3xs text-muted-foreground/60 leading-snug">{hint}</span>}
      </span>
    </label>
  );
}

function Slider({ title, value, min, max, step, suffix, onChange, fixed }: {
  title: string; value: number; min: number; max: number; step: number; suffix: string; onChange: (n: number) => void; fixed?: number;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex justify-between text-xs text-foreground/80">
        <span>{title}</span>
        <span className="font-mono text-primary">{fixed != null ? value.toFixed(fixed) : value}{suffix}</span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full accent-primary h-1.5 bg-secondary rounded-lg cursor-pointer"
      />
    </div>
  );
}

export default SettingsPanel;
