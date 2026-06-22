import type { ThemeType } from '../App';
import type { Editor as TiptapEditor } from '@tiptap/react';
import {
  Sliders,
  Bold,
  Italic,
  Underline,
  List,
  ListOrdered,
  ListTodo,
  Type,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignJustify,
  Baseline,
} from 'lucide-react';

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

function RightSidebar({
  editor,
  isOpen,
  theme,
  editorFont,
  setEditorFont,
  editorSize,
  setEditorSize,
  lineHeight,
  setLineHeight,
}: RightSidebarProps) {
  if (!isOpen) return null;

  const getBtnStyle = (isActive: boolean) => {
    const isLight = theme === 'light';
    const activeBg = isLight ? '#0078d4' : 'var(--primary)';
    const activeColor = isLight ? '#ffffff' : 'var(--primary-foreground)';
    const baseBg = 'rgba(var(--secondary), 0.05)';
    const textColor = isLight && !isActive ? '#333' : 'inherit';

    return {
      background: isActive ? activeBg : baseBg,
      color: isActive ? activeColor : textColor,
    };
  };

  const iconBtn =
    'h-8 flex items-center justify-center rounded-lg border border-border/30 hover:bg-secondary/40 active:scale-95 transition-all cursor-pointer';

  const sectionLabel =
    'text-3xs font-semibold tracking-[0.12em] text-muted-foreground/70 uppercase mb-1';

  return (
    <aside className="w-64 max-w-[85vw] shrink-0 h-full bg-sidebar border-l border-border/40 flex flex-col select-none transition-all duration-200 overflow-y-auto">
      {/* Sidebar Header */}
      <div className="h-10 flex items-center gap-2 px-4 border-b border-border/30">
        <Sliders className="w-3.5 h-3.5 text-primary" />
        <span className="text-3xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">
          Text Controller
        </span>
      </div>

      <div className="p-4 flex flex-col gap-6">
        {editor && (
          <div className="flex flex-col gap-2.5">
            <h4 className={sectionLabel}>Formatting Options</h4>

            {/* Inline style actions */}
            <div className="grid grid-cols-4 gap-1.5">
              <button
                onClick={() => editor.chain().focus().toggleBold().run()}
                title="Bold (Ctrl+B)"
                style={getBtnStyle(editor.isActive('bold'))}
                className={iconBtn}
              >
                <Bold className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => editor.chain().focus().toggleItalic().run()}
                title="Italic (Ctrl+I)"
                style={getBtnStyle(editor.isActive('italic'))}
                className={iconBtn}
              >
                <Italic className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => editor.chain().focus().toggleUnderline().run()}
                title="Underline (Ctrl+U)"
                style={getBtnStyle(editor.isActive('underline'))}
                className={iconBtn}
              >
                <Underline className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => editor.chain().focus().toggleBulletList().run()}
                title="Bullet List"
                style={getBtnStyle(editor.isActive('bulletList'))}
                className={iconBtn}
              >
                <List className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Ordered list + headings */}
            <div className="grid grid-cols-4 gap-1.5">
              <button
                onClick={() => editor.chain().focus().toggleOrderedList().run()}
                title="Numbered List"
                style={getBtnStyle(editor.isActive('orderedList'))}
                className={iconBtn}
              >
                <ListOrdered className="w-3.5 h-3.5" />
              </button>
              {([1, 2, 3] as const).map((level) => (
                <button
                  key={level}
                  onClick={() => editor.chain().focus().toggleHeading({ level }).run()}
                  title={`Heading ${level} (Ctrl+${level})`}
                  style={getBtnStyle(editor.isActive('heading', { level }))}
                  className={`${iconBtn} text-3xs font-bold`}
                >
                  H{level}
                </button>
              ))}
            </div>

            {/* To-do list — Notes only. The right sidebar is rendered solely for
                text documents, so this stays out of mind maps / fantasy maps. */}
            <button
              onClick={() => editor.chain().focus().toggleTaskList().run()}
              title="To-do list (or type /todo)"
              style={getBtnStyle(editor.isActive('taskList'))}
              className={`${iconBtn} w-full gap-2 text-xs font-medium`}
            >
              <ListTodo className="w-3.5 h-3.5" />
              To-do List
            </button>
          </div>
        )}

        {/* Paragraph alignment */}
        {editor && (
          <div className="flex flex-col gap-2.5">
            <h4 className={sectionLabel}>Content Alignment</h4>
            <div className="grid grid-cols-4 gap-1.5">
              <button
                onClick={() => editor.chain().focus().setTextAlign('left').run()}
                title="Align Left"
                style={getBtnStyle(editor.isActive({ textAlign: 'left' }))}
                className={iconBtn}
              >
                <AlignLeft className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => editor.chain().focus().setTextAlign('center').run()}
                title="Align Center"
                style={getBtnStyle(editor.isActive({ textAlign: 'center' }))}
                className={iconBtn}
              >
                <AlignCenter className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => editor.chain().focus().setTextAlign('right').run()}
                title="Align Right"
                style={getBtnStyle(editor.isActive({ textAlign: 'right' }))}
                className={iconBtn}
              >
                <AlignRight className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => editor.chain().focus().setTextAlign('justify').run()}
                title="Justify"
                style={getBtnStyle(editor.isActive({ textAlign: 'justify' }))}
                className={iconBtn}
              >
                <AlignJustify className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}

        <div className="flex flex-col gap-4">
          <h4 className={sectionLabel}>Typography Layout</h4>

          {/* Font Size slider */}
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

          {/* Line Spacing slider */}
          <div className="flex flex-col gap-1.5">
            <div className="flex justify-between text-xs text-foreground/80">
              <label className="flex items-center gap-1.5">
                <Baseline className="w-3.5 h-3.5 text-primary/80" />
                Line Spacing
              </label>
              <span className="font-mono font-medium text-primary text-xs">
                {lineHeight.toFixed(1)}×
              </span>
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

          {/* Font Family selector */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-foreground/80">Font Family</label>
            <select
              className="w-full bg-secondary/40 border border-border/30 text-foreground text-xs rounded-lg px-2.5 py-1.5 focus:border-primary/50 focus:ring-1 focus:ring-primary/20 outline-none cursor-pointer transition-all duration-200"
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
