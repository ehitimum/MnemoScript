import type { ThemeType } from '../App';
import type { Editor as TiptapEditor } from '@tiptap/react';
import { Sliders, Bold, Italic, List, ListOrdered, Type } from 'lucide-react';

interface RightSidebarProps {
  editor: TiptapEditor | null;
  isOpen: boolean;
  theme: ThemeType;
  editorFont: string;
  setEditorFont: (font: string) => void;
  editorSize: number;
  setEditorSize: (size: number) => void;
}

function RightSidebar({
  editor,
  isOpen,
  theme,
  editorFont,
  setEditorFont,
  editorSize,
  setEditorSize,
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

  return (
    <aside className="w-64 bg-sidebar border-l border-border/40 flex flex-col select-none transition-all duration-200 overflow-y-auto">
      {/* Sidebar Header */}
      <div className="h-10 flex items-center gap-2 px-4 border-b border-border/30">
        <Sliders className="w-4 h-4 text-primary" />
        <span className="text-2xs font-semibold tracking-wider text-muted-foreground uppercase">
          Text Controller
        </span>
      </div>

      <div className="p-4 flex flex-col gap-6">
        {editor && (
          <div className="flex flex-col gap-2.5">
            <h4 className="text-2xs font-semibold tracking-wider text-muted-foreground uppercase mb-1">
              Formatting Options
            </h4>
            
            {/* Format actions grid */}
            <div className="grid grid-cols-4 gap-1.5">
              <button 
                onClick={() => editor.chain().focus().toggleBold().run()}
                title="Bold (Ctrl+B)"
                style={getBtnStyle(editor.isActive('bold'))}
                className="h-8 flex items-center justify-center rounded-lg border border-border/30 hover:bg-secondary/40 active:scale-95 transition-all cursor-pointer"
              >
                <Bold className="w-3.5 h-3.5" />
              </button>
              <button 
                onClick={() => editor.chain().focus().toggleItalic().run()}
                title="Italic (Ctrl+I)"
                style={getBtnStyle(editor.isActive('italic'))}
                className="h-8 flex items-center justify-center rounded-lg border border-border/30 hover:bg-secondary/40 active:scale-95 transition-all cursor-pointer"
              >
                <Italic className="w-3.5 h-3.5" />
              </button>
              <button 
                onClick={() => editor.chain().focus().toggleBulletList().run()}
                title="Bullet List"
                style={getBtnStyle(editor.isActive('bulletList'))}
                className="h-8 flex items-center justify-center rounded-lg border border-border/30 hover:bg-secondary/40 active:scale-95 transition-all cursor-pointer"
              >
                <List className="w-3.5 h-3.5" />
              </button>
              <button 
                onClick={() => editor.chain().focus().toggleOrderedList().run()}
                title="Numbered List"
                style={getBtnStyle(editor.isActive('orderedList'))}
                className="h-8 flex items-center justify-center rounded-lg border border-border/30 hover:bg-secondary/40 active:scale-95 transition-all cursor-pointer"
              >
                <ListOrdered className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Headings options */}
            <div className="flex gap-1.5">
              {([1, 2, 3] as const).map((level) => (
                <button
                  key={level}
                  onClick={() => editor.chain().focus().toggleHeading({ level }).run()}
                  title={`Heading ${level} (Ctrl+${level})`}
                  style={getBtnStyle(editor.isActive('heading', { level }))}
                  className="flex-1 h-7 text-3xs font-bold flex items-center justify-center rounded-md border border-border/30 hover:bg-secondary/40 active:scale-95 transition-all cursor-pointer"
                >
                  H{level}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="flex flex-col gap-4">
          <h4 className="text-2xs font-semibold tracking-wider text-muted-foreground uppercase mb-1">
            Typography Layout
          </h4>
          
          {/* Font Size slider */}
          <div className="flex flex-col gap-1.5">
            <div className="flex justify-between text-xs text-foreground/80">
              <label className="flex items-center gap-1">
                <Type className="w-3.5 h-3.5 text-primary/80" />
                Font Size
              </label>
              <span className="font-mono font-medium text-primary text-xs">{editorSize}px</span>
            </div>
            <input 
              type="range" min="12" max="24" 
              className="w-full accent-primary h-1.5 bg-secondary rounded-lg cursor-pointer"
              value={editorSize} onChange={(e) => setEditorSize(parseInt(e.target.value))}
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