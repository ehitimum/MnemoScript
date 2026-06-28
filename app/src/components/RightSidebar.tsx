import type { ThemeType } from '../App';
import type { Editor as TiptapEditor } from '@tiptap/react';
import { Sliders, Type, Baseline } from 'lucide-react';
import FormatControls from './controls/FormatControls';
import ReadAloudControls from './controls/ReadAloudControls';
import DictationControls from './controls/DictationControls';

interface RightSidebarProps {
  editor: TiptapEditor | null;
  isOpen: boolean;
  theme: ThemeType;
  editorFont: string;
  setEditorFont: (font: string) => void;
  editorSize: number;
  setEditorSize: (size: number) => void;
  lineHeight: number;
  setLineHeight: (lh: number) => void;
}

/**
 * Desktop right panel ("Format"). Hosts the shared editor control groups (also
 * used by the mobile Tools sheet) plus typography tuning. Rendered only for text
 * documents (App.tsx gates on docType==='text').
 */
function RightSidebar({
  editor,
  isOpen,
  editorFont,
  setEditorFont,
  editorSize,
  setEditorSize,
  lineHeight,
  setLineHeight,
}: RightSidebarProps) {
  if (!isOpen) return null;

  const sectionLabel =
    'text-3xs font-semibold tracking-[0.12em] text-muted-foreground/70 uppercase';

  return (
    <aside className="w-64 max-w-[85vw] shrink-0 h-full bg-sidebar border-l border-border/40 flex flex-col select-none overflow-y-auto">
      <div className="h-10 flex items-center gap-2 px-4 border-b border-border/30">
        <Sliders className="w-3.5 h-3.5 text-primary" />
        <span className="text-3xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">
          Format
        </span>
      </div>

      <div className="p-4 flex flex-col gap-6">
        <FormatControls editor={editor} size="sm" />
        <ReadAloudControls editor={editor} size="sm" />
        <DictationControls editor={editor} size="sm" />

        {/* Typography */}
        <div className="flex flex-col gap-4">
          <h4 className={sectionLabel}>Typography</h4>

          <div className="flex flex-col gap-1.5">
            <div className="flex justify-between text-xs text-foreground/80">
              <label className="flex items-center gap-1.5">
                <Type className="w-3.5 h-3.5 text-primary/80" />
                Font Size
              </label>
              <span className="font-mono font-medium text-primary text-xs">{editorSize}px</span>
            </div>
            <input
              type="range"
              min="12"
              max="24"
              className="w-full accent-primary h-1.5 bg-secondary rounded-lg cursor-pointer"
              value={editorSize}
              onChange={(e) => setEditorSize(parseInt(e.target.value))}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <div className="flex justify-between text-xs text-foreground/80">
              <label className="flex items-center gap-1.5">
                <Baseline className="w-3.5 h-3.5 text-primary/80" />
                Line Spacing
              </label>
              <span className="font-mono font-medium text-primary text-xs">{lineHeight.toFixed(1)}×</span>
            </div>
            <input
              type="range"
              min="1"
              max="2.5"
              step="0.1"
              className="w-full accent-primary h-1.5 bg-secondary rounded-lg cursor-pointer"
              value={lineHeight}
              onChange={(e) => setLineHeight(parseFloat(e.target.value))}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-foreground/80">Font Family</label>
            <select
              className="w-full bg-secondary/40 border border-border/30 text-foreground text-xs rounded-lg px-2.5 py-1.5 focus:border-primary/50 outline-none cursor-pointer"
              value={editorFont}
              onChange={(e) => setEditorFont(e.target.value)}
            >
              <option value="Inter">Inter — clean sans</option>
              <option value="Georgia">Georgia — classic serif</option>
              <option value="'Times New Roman', serif">Times — manuscript serif</option>
              <option value="'Courier New', monospace">Courier — typewriter</option>
            </select>
          </div>
        </div>
      </div>
    </aside>
  );
}

export default RightSidebar;
