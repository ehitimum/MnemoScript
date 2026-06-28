import type { Project, Document } from '../types';
import {
  BookOpen,
  Plus,
  Save,
  FileDown,
  PanelLeft,
  PanelRight,
  Search,
  ChevronRight,
} from 'lucide-react';

interface Props {
  selectedProject: Project | null;
  selectedDocument: Document | null;
  onOpenPalette: () => void;
  onNew: () => void;
  onSave: () => void;
  canSave: boolean;
  onCompile: () => void;
  canCompile: boolean;
  showPanelToggles: boolean;
  isLeftSidebarOpen: boolean;
  setIsLeftSidebarOpen: (v: boolean) => void;
  isRightSidebarOpen: boolean;
  setIsRightSidebarOpen: (v: boolean) => void;
}

const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform);

/** Slim, app-like desktop top bar. Replaces the VS Code menubar; most actions
 *  live in the ⌘K command palette. */
function DesktopTopBar({
  selectedProject,
  selectedDocument,
  onOpenPalette,
  onNew,
  onSave,
  canSave,
  onCompile,
  canCompile,
  showPanelToggles,
  isLeftSidebarOpen,
  setIsLeftSidebarOpen,
  isRightSidebarOpen,
  setIsRightSidebarOpen,
}: Props) {
  const iconBtn =
    'w-8 h-8 flex items-center justify-center rounded-lg text-muted-foreground hover:bg-secondary/60 hover:text-foreground active:scale-95 transition-all cursor-pointer disabled:opacity-35 disabled:pointer-events-none';
  const toggleBtn = (active: boolean) =>
    `w-8 h-8 flex items-center justify-center rounded-lg active:scale-95 transition-all cursor-pointer ${
      active ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground'
    }`;

  return (
    <header className="h-12 flex items-center gap-2 px-3 border-b border-border/30 bg-background/85 backdrop-blur-md select-none">
      {/* Brand + breadcrumb */}
      <div className="flex items-center gap-2.5 min-w-0">
        <div className="w-7 h-7 rounded-lg bg-primary/12 flex items-center justify-center text-primary shrink-0">
          <BookOpen className="w-4 h-4" />
        </div>
        <div className="flex items-center gap-1.5 min-w-0 text-sm">
          <span className="font-semibold text-foreground/90 truncate max-w-[18ch]">
            {selectedProject ? selectedProject.name : 'MnemoScript'}
          </span>
          {selectedDocument && (
            <>
              <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/50 shrink-0" />
              <span className="text-muted-foreground truncate max-w-[22ch]">{selectedDocument.title}</span>
            </>
          )}
        </div>
      </div>

      {/* Command palette trigger */}
      <button
        onClick={onOpenPalette}
        className="ml-2 hidden sm:flex items-center gap-2 h-8 px-3 rounded-lg border border-border/40 bg-secondary/25 text-muted-foreground hover:bg-secondary/45 hover:text-foreground transition-all cursor-pointer"
        title="Command palette"
      >
        <Search className="w-3.5 h-3.5" />
        <span className="text-xs">Search commands</span>
        <kbd className="text-3xs border border-border/50 rounded px-1.5 py-0.5 ml-1">{isMac ? '⌘' : 'Ctrl'} K</kbd>
      </button>

      <div className="flex-1" />

      {/* Primary actions */}
      <button className={iconBtn} onClick={onNew} title="New project">
        <Plus className="w-4 h-4" />
      </button>
      <button className={iconBtn} onClick={onSave} disabled={!canSave} title="Save (Ctrl+S)">
        <Save className="w-4 h-4" />
      </button>
      <button className={iconBtn} onClick={onCompile} disabled={!canCompile} title="Compile to PDF book">
        <FileDown className="w-4 h-4" />
      </button>

      {showPanelToggles && (
        <>
          <div className="w-px h-5 bg-border/50 mx-1" />
          <button className={toggleBtn(isLeftSidebarOpen)} onClick={() => setIsLeftSidebarOpen(!isLeftSidebarOpen)} title="Toggle explorer">
            <PanelLeft className="w-4 h-4" />
          </button>
          <button className={toggleBtn(isRightSidebarOpen)} onClick={() => setIsRightSidebarOpen(!isRightSidebarOpen)} title="Toggle format panel">
            <PanelRight className="w-4 h-4" />
          </button>
        </>
      )}

      {/* Command palette trigger (compact, small screens) */}
      <button onClick={onOpenPalette} className={`sm:hidden ${iconBtn}`} title="Command palette">
        <Search className="w-4 h-4" />
      </button>
    </header>
  );
}

export default DesktopTopBar;
