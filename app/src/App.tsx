import { useState, useEffect, useRef, useCallback, lazy, Suspense, type ReactNode } from 'react';
import Sidebar from './components/Sidebar';
import Editor from './components/Editor';
import MindMap from './components/MindMap';
import SettingsPanel from './components/SettingsPanel';
import { createDefaultMapDoc } from './components/fantasymap/mapTypes';

// The map studio pulls in Konva + the icon set + an SVG renderer, so load it on
// demand (only when a fantasy-map document is opened) to keep the initial bundle lean.
const FantasyMap = lazy(() => import('./components/FantasyMap'));
import DesktopTopBar from './components/DesktopTopBar';
import CommandPalette, { type Command } from './components/CommandPalette';
import RightSidebar from './components/RightSidebar';
import MobileShell from './components/mobile/MobileShell';
import ProjectCreationModal from './components/ProjectCreationModal';
import BookCompiler from './components/BookCompiler';
import { api } from './lib/api';
import { useShell, isTauri, isMobileOS } from './lib/platform';
import { THEMES } from './lib/prefs';
import type { Project, Document, DocType, Folder } from './types';
import type { Editor as TiptapEditor } from '@tiptap/react';
import {
  Plus,
  Settings,
  FolderOpen,
  FolderSearch,
  ArrowRight,
  BookOpen,
  Save,
  FileDown,
  PanelLeft,
  PanelRight,
  Palette,
  Copy,
  Info,
  X,
  PenLine,
  MousePointer2,
  AlertTriangle,
} from 'lucide-react';

export type ThemeType = 'dark' | 'light' | 'glass' | 'ocean' | 'forest' | 'sunset';

/** A localStorage-backed UI preference (theme, fonts, toggles…). */
function usePref<T extends string | number | boolean>(key: string, fallback: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => {
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    if (typeof fallback === 'number') return (Number(raw) || fallback) as T;
    if (typeof fallback === 'boolean') return (raw === 'true') as T;
    return raw as T;
  });
  useEffect(() => {
    localStorage.setItem(key, String(value));
  }, [key, value]);
  return [value, setValue];
}

/** On narrow desktop windows the side panels float over the editor as
 *  slide-in drawers with a tap-to-dismiss backdrop, instead of squeezing it. */
function Drawer({ side, onClose, children }: { side: 'left' | 'right'; onClose: () => void; children: ReactNode }) {
  return (
    <>
      <div className="absolute inset-0 z-30 bg-background/55 backdrop-blur-[2px] animate-in fade-in duration-150" onClick={onClose} />
      <div
        className={`absolute inset-y-0 ${side === 'left' ? 'left-0' : 'right-0'} z-40 flex shadow-2xl animate-in duration-200 ${
          side === 'left' ? 'slide-in-from-left' : 'slide-in-from-right'
        }`}
      >
        {children}
      </div>
    </>
  );
}

function EmptyEditorState({ onNew }: { onNew: () => void }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8 text-center bg-background">
      <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center text-primary">
        <PenLine className="w-6 h-6" />
      </div>
      <div className="flex flex-col gap-1.5">
        <p className="text-base font-medium text-foreground">Pick a document to start writing</p>
        <p className="text-sm text-muted-foreground max-w-xs">
          Choose one from the explorer, or create a new chapter, scene or note.
        </p>
      </div>
      <button
        onClick={onNew}
        className="flex items-center gap-2 bg-primary text-primary-foreground text-sm font-medium px-4 py-2 rounded-lg hover:opacity-90 active:scale-95 transition-all cursor-pointer"
      >
        <Plus className="w-4 h-4" /> New Chapter
      </button>
    </div>
  );
}

function App() {
  const [wordCount, setWordCount] = useState(0);
  const [charCount, setCharCount] = useState(0);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [selectedDocument, setSelectedDocument] = useState<Document | null>(null);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);

  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isCompilerOpen, setIsCompilerOpen] = useState(false);
  const [isEditingSettings, setIsEditingSettings] = useState(false);

  // UI preferences (localStorage). Projects/documents live on disk via the backend.
  const [theme, setTheme] = usePref<ThemeType>('mnemo_theme', 'dark');
  const [editorFont, setEditorFont] = usePref<string>('mnemo_font', 'Inter');
  const [editorSize, setEditorSize] = usePref<number>('mnemo_size', 16);
  const [lineHeight, setLineHeight] = usePref<number>('mnemo_lineheight', 1.6);
  const [editorPadding, setEditorPadding] = usePref<number>('mnemo_padding', 30);
  const [spellcheckActive, setSpellcheckActive] = usePref<boolean>('mnemo_spellcheck', true);
  const [smoothCaret, setSmoothCaret] = usePref<boolean>('mnemo_smoothcaret', true);
  const [autoSaveInterval, setAutoSaveInterval] = usePref<number>('mnemo_interval', 30);
  const [defaultSavePath, setDefaultSavePath] = usePref<string>('mnemo_path', '');

  // Which shell to render is a *platform* decision (phone vs. desktop); the
  // narrow-viewport flag only collapses the desktop panels into drawers.
  const { isMobileShell, isNarrow } = useShell();
  const [isLeftSidebarOpen, setIsLeftSidebarOpen] = useState(!isNarrow);
  const [isRightSidebarOpen, setIsRightSidebarOpen] = useState(false);
  const [isPaletteOpen, setIsPaletteOpen] = useState(false);

  // When crossing the breakpoint, show the explorer on wide windows and collapse
  // the panels on narrow ones (adjusting state during render, per React docs).
  const [prevNarrow, setPrevNarrow] = useState(isNarrow);
  if (prevNarrow !== isNarrow) {
    setPrevNarrow(isNarrow);
    setIsLeftSidebarOpen(!isNarrow);
    setIsRightSidebarOpen(false);
  }

  const [activeEditor, setActiveEditor] = useState<TiptapEditor | null>(null);
  const [isSaved, setIsSaved] = useState(true);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [autoSaveEnabled, setAutoSaveEnabled] = useState(true);

  const isMindMap = selectedDocument?.docType === 'mindmap';
  const isFantasyMap = selectedDocument?.docType === 'fantasymap';
  const isTextDoc = selectedDocument?.docType === 'text';

  const refreshProjects = useCallback(() => {
    api.listProjects().then(setProjects).catch((e) => console.error('Failed to list projects:', e));
  }, []);

  // Load all projects from disk on startup (metadata only; documents are loaded on open).
  useEffect(() => {
    refreshProjects();
  }, [refreshProjects]);

  useEffect(() => {
    document.body.className = `theme-${theme}`;
  }, [theme]);

  // ── Persistence: refs of the live doc/project/dirty flag so the auto-save
  // interval and the save handlers always read current values (no stale closures).
  const selectedProjectRef = useRef(selectedProject);
  const selectedDocumentRef = useRef(selectedDocument);
  const isSavedRef = useRef(isSaved);
  useEffect(() => {
    selectedProjectRef.current = selectedProject;
  }, [selectedProject]);
  useEffect(() => {
    selectedDocumentRef.current = selectedDocument;
  }, [selectedDocument]);
  useEffect(() => {
    isSavedRef.current = isSaved;
  }, [isSaved]);

  const persistCurrent = useCallback(async () => {
    const proj = selectedProjectRef.current;
    const doc = selectedDocumentRef.current;
    if (!proj || !doc) return;
    try {
      await api.saveDocument(proj.id, doc);
      isSavedRef.current = true;
      setIsSaved(true);
      setSaveError(null);
    } catch (e) {
      console.error('Save failed:', e);
      setSaveError((e as Error).message || 'Save failed');
    }
  }, []);

  /** Save the open document right now if it has unsaved edits. Called before
   *  switching documents/projects and when the app is closed or backgrounded,
   *  so edits can never be stranded in memory. */
  const flushIfDirty = useCallback(async () => {
    if (!isSavedRef.current) await persistCurrent();
  }, [persistCurrent]);

  // Auto-save loop: persists the open document whenever it is dirty.
  useEffect(() => {
    if (!autoSaveEnabled) return;
    const id = setInterval(() => {
      if (!isSavedRef.current) persistCurrent();
    }, Math.max(5, autoSaveInterval) * 1000);
    return () => clearInterval(id);
  }, [autoSaveEnabled, autoSaveInterval, persistCurrent]);

  // Flush when the app goes to the background (phones kill backgrounded apps)
  // and, on desktop, when the window is closed.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') void flushIfDirty();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [flushIfDirty]);

  useEffect(() => {
    if (!isTauri || isMobileOS) return;
    let unlisten: (() => void) | undefined;
    let closing = false;
    import('@tauri-apps/api/window')
      .then(({ getCurrentWindow }) => {
        const win = getCurrentWindow();
        return win.onCloseRequested(async (event) => {
          if (closing || isSavedRef.current) return;
          event.preventDefault();
          closing = true;
          await flushIfDirty();
          await win.close();
        });
      })
      .then((u) => {
        unlisten = u;
      })
      .catch(() => {});
    return () => unlisten?.();
  }, [flushIfDirty]);

  // Live word/character count (debounced so long documents never stutter).
  useEffect(() => {
    if (!activeEditor) return;
    let timer = 0;
    const compute = () => {
      const text = activeEditor.getText();
      setWordCount(text.trim().split(/\s+/).filter((w) => w.length > 0).length);
      setCharCount(text.replace(/\s/g, '').length);
    };
    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(compute, 180);
    };
    schedule();
    activeEditor.on('update', schedule);
    return () => {
      window.clearTimeout(timer);
      activeEditor.off('update', schedule);
    };
  }, [activeEditor]);

  /** Switch the open document, saving the previous one first if needed. */
  const selectDocument = useCallback(
    async (doc: Document | null) => {
      if (doc?.id === selectedDocumentRef.current?.id && doc !== null) {
        setIsEditingSettings(false);
        return;
      }
      await flushIfDirty();
      selectedDocumentRef.current = doc;
      setSelectedDocument(doc);
      isSavedRef.current = true;
      setIsSaved(true);
      setIsEditingSettings(false);
    },
    [flushIfDirty],
  );

  const handleProjectCreated = (newProj: Project) => {
    setProjects((prev) => [newProj, ...prev.filter((p) => p.id !== newProj.id)]);
    setSelectedProject(newProj);
    setDocuments(newProj.documents || []);
    setFolders(newProj.folders || []);
    void selectDocument(null);
    setIsCreateModalOpen(false);
  };

  // Load a project's documents from disk before opening it.
  const handleOpenProject = async (proj: Project) => {
    await flushIfDirty();
    try {
      const full = await api.loadProject(proj.id);
      setSelectedProject(full);
      setDocuments(full.documents || []);
      setFolders(full.folders || []);
    } catch (e) {
      console.error('Failed to open project, using cached metadata:', e);
      setSelectedProject(proj);
      setDocuments(proj.documents || []);
      setFolders(proj.folders || []);
    }
    void selectDocument(null);
  };

  /** Desktop: open an existing project folder that isn't in the recent list. */
  const handleOpenProjectFolder = async () => {
    try {
      const dir = await api.selectDirectory();
      if (!dir) return;
      const proj = await api.openProjectByPath(dir);
      await handleOpenProject(proj);
      refreshProjects();
    } catch (e) {
      console.error('Failed to open project folder:', e);
      alert(`That folder doesn't contain a MnemoScript project.\n\n${(e as Error).message ?? ''}`);
    }
  };

  /** Remove a project from the recent list (files are kept on disk). */
  const handleForgetProject = async (proj: Project) => {
    if (!window.confirm(`Remove "${proj.name}" from the list?\n\nThe project folder stays on disk; you can open it again later.`)) return;
    try {
      await api.deleteProject(proj.id, false);
      setProjects((prev) => prev.filter((p) => p.id !== proj.id));
    } catch (e) {
      console.error('Failed to remove project:', e);
    }
  };

  const handleCreateDocument = async (title: string, docType: DocType = 'text', folderId: string | null = null) => {
    if (!selectedProject) return;
    const initialContent =
      docType === 'mindmap' ? '{"nodes":[],"edges":[]}' : docType === 'fantasymap' ? JSON.stringify(createDefaultMapDoc('world')) : '';
    try {
      const created = await api.createDocument(selectedProject.id, title, initialContent, docType, documents.length);
      // The backend `create_document` command doesn't take a folder; if the doc
      // is meant to live inside a directory, stamp it and persist once more.
      let newDoc = created;
      if (folderId) {
        newDoc = { ...created, folderId };
        await api.saveDocument(selectedProject.id, newDoc);
      }
      setDocuments((prev) => [...prev, newDoc]);
      await selectDocument(newDoc);
    } catch (e) {
      console.error('Failed to create document:', e);
    }
  };

  /** Persist the folder tree (folders live in project.json, saved via save_project). */
  const persistFolders = useCallback(
    async (nextFolders: Folder[]) => {
      setFolders(nextFolders);
      if (!selectedProject) return;
      const updated = { ...selectedProject, folders: nextFolders, documents };
      setSelectedProject(updated);
      try {
        await api.saveProject(updated);
      } catch (e) {
        console.error('Failed to save folders:', e);
      }
    },
    [selectedProject, documents],
  );

  const handleCreateFolder = (name: string, parentId: string | null = null) => {
    const folder: Folder = {
      id: crypto.randomUUID(),
      name: name.trim() || 'New Directory',
      order: folders.length,
      parentId: parentId ?? null,
    };
    persistFolders([...folders, folder]);
  };

  const handleRenameFolder = (id: string, name: string) => {
    persistFolders(folders.map((f) => (f.id === id ? { ...f, name: name.trim() || f.name } : f)));
  };

  /** Delete a folder, lifting its child folders and documents up to its parent. */
  const handleDeleteFolder = async (id: string) => {
    if (!selectedProject) return;
    const target = folders.find((f) => f.id === id);
    const newParent = target?.parentId ?? null;

    const nextFolders = folders.filter((f) => f.id !== id).map((f) => (f.parentId === id ? { ...f, parentId: newParent } : f));

    // Reassign documents in this folder to the parent and persist each.
    const movedDocs = documents.filter((d) => (d.folderId ?? null) === id);
    const nextDocs = documents.map((d) => ((d.folderId ?? null) === id ? { ...d, folderId: newParent } : d));
    setDocuments(nextDocs);
    try {
      await Promise.all(movedDocs.map((d) => api.saveDocument(selectedProject.id, { ...d, folderId: newParent })));
    } catch (e) {
      console.error('Failed to reassign documents on folder delete:', e);
    }
    persistFolders(nextFolders);
  };

  const handleMoveDocuments = async (docIds: string[], folderId: string | null) => {
    if (!selectedProject) return;
    const idSet = new Set(docIds);
    const moved = documents.filter((d) => idSet.has(d.id) && (d.folderId ?? null) !== folderId).map((d) => ({ ...d, folderId }));
    if (moved.length === 0) return;
    const movedById = new Map(moved.map((d) => [d.id, d]));
    setDocuments((prev) => prev.map((d) => movedById.get(d.id) ?? d));
    if (selectedDocument && movedById.has(selectedDocument.id)) {
      const next = movedById.get(selectedDocument.id)!;
      setSelectedDocument(next);
      selectedDocumentRef.current = next;
    }
    try {
      await Promise.all(moved.map((d) => api.saveDocument(selectedProject.id, d)));
    } catch (e) {
      console.error('Failed to move documents:', e);
    }
  };

  const handleRenameDocument = async (docId: string, title: string) => {
    if (!selectedProject) return;
    const doc = documents.find((d) => d.id === docId);
    const trimmed = title.trim();
    if (!doc || !trimmed || trimmed === doc.title) return;
    const renamed = { ...doc, title: trimmed, updated_at: new Date().toISOString() };
    setDocuments((prev) => prev.map((d) => (d.id === docId ? renamed : d)));
    if (selectedDocument?.id === docId) {
      setSelectedDocument(renamed);
      selectedDocumentRef.current = renamed;
    }
    try {
      await api.saveDocument(selectedProject.id, renamed);
    } catch (e) {
      console.error('Failed to rename document:', e);
    }
  };

  const handleDeleteDocuments = async (docIds: string[]) => {
    if (!selectedProject) return;
    const idSet = new Set(docIds);
    setDocuments((prev) => prev.filter((d) => !idSet.has(d.id)));
    if (selectedDocument && idSet.has(selectedDocument.id)) {
      selectedDocumentRef.current = null;
      setSelectedDocument(null);
      isSavedRef.current = true;
      setIsSaved(true);
    }
    try {
      await Promise.all(docIds.map((id) => api.deleteDocument(selectedProject.id, id)));
    } catch (e) {
      console.error('Failed to delete documents:', e);
    }
  };

  /**
   * Duplicate documents (used by copy/paste and "Duplicate"). When `folderId` is
   * `undefined` each copy stays in its source's folder; otherwise all copies are
   * placed in `folderId` (used by paste-into-folder).
   */
  const handleDuplicateDocuments = async (docIds: string[], folderId?: string | null) => {
    if (!selectedProject) return;
    const idSet = new Set(docIds);
    const sources = documents.filter((d) => idSet.has(d.id));
    try {
      const created: Document[] = [];
      for (const src of sources) {
        const target = folderId === undefined ? (src.folderId ?? null) : folderId;
        const copy = await api.createDocument(selectedProject.id, `${src.title} copy`, src.content, src.docType, documents.length + created.length);
        const placed = { ...copy, folderId: target };
        await api.saveDocument(selectedProject.id, placed);
        created.push(placed);
      }
      setDocuments((prev) => [...prev, ...created]);
    } catch (e) {
      console.error('Failed to duplicate documents:', e);
    }
  };

  /** True if `maybeAncestorId` is `folderId` itself or one of its ancestors. */
  const isFolderAncestor = useCallback(
    (folderId: string, maybeAncestorId: string): boolean => {
      let current: string | null | undefined = folderId;
      while (current) {
        if (current === maybeAncestorId) return true;
        current = folders.find((f) => f.id === current)?.parentId ?? null;
      }
      return false;
    },
    [folders],
  );

  const handleMoveFolder = (folderId: string, newParentId: string | null) => {
    if (folderId === newParentId) return;
    // Prevent dropping a folder into itself or one of its own descendants.
    if (newParentId && isFolderAncestor(newParentId, folderId)) return;
    persistFolders(folders.map((f) => (f.id === folderId ? { ...f, parentId: newParentId } : f)));
  };

  // Stable reference (reads the live doc from the ref) so child editors that
  // depend on it — notably the maps' debounced persist effects — don't re-run
  // on every App render.
  const documentsRef = useRef(documents);
  useEffect(() => {
    documentsRef.current = documents;
  }, [documents]);

  const handleUpdateDocumentContent = useCallback((updatedContent: string, docId?: string) => {
    const current = selectedDocumentRef.current;
    const targetId = docId ?? current?.id;
    if (!targetId) return;
    const updated_at = new Date().toISOString();

    if (current && current.id === targetId) {
      isSavedRef.current = false;
      setIsSaved(false);
      const stamped = { ...current, content: updatedContent, updated_at };
      selectedDocumentRef.current = stamped;
      setSelectedDocument(stamped);
      setDocuments((prevDocs) => prevDocs.map((d) => (d.id === stamped.id ? stamped : d)));
      return;
    }

    // A canvas (mind map / fantasy map) flushed its last debounced edits while
    // we were already switching away from it: update that document in the list
    // and persist it directly so nothing is lost or written to the wrong file.
    const doc = documentsRef.current.find((d) => d.id === targetId);
    const proj = selectedProjectRef.current;
    if (!doc || !proj) return;
    const stamped = { ...doc, content: updatedContent, updated_at };
    setDocuments((prevDocs) => prevDocs.map((d) => (d.id === targetId ? stamped : d)));
    api.saveDocument(proj.id, stamped).catch((e) => console.error('Save failed:', e));
  }, []);

  const handleCloseProject = async () => {
    await flushIfDirty();
    setSelectedProject(null);
    selectedDocumentRef.current = null;
    setSelectedDocument(null);
    setDocuments([]);
    setFolders([]);
    setIsEditingSettings(false);
    // Refresh the project list so the welcome screen reflects any new projects.
    refreshProjects();
  };

  // Desktop keyboard shortcuts: ⌘K / Ctrl+K toggles the command palette; ⌘S saves.
  useEffect(() => {
    if (isMobileShell) return;
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsPaletteOpen((o) => !o);
      } else if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (selectedDocumentRef.current) persistCurrent();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isMobileShell, persistCurrent]);

  // Command palette entries — the desktop action surface.
  const themeCommands: Command[] = THEMES.map((t) => ({
    id: `theme-${t.id}`,
    label: `Theme: ${t.label}`,
    group: 'Theme',
    icon: Palette,
    run: () => setTheme(t.id),
  }));

  const commands: Command[] = [
    { id: 'new-project', label: 'New Project', group: 'File', icon: Plus, run: () => setIsCreateModalOpen(true) },
    ...(isTauri && !isMobileOS
      ? [{ id: 'open-folder', label: 'Open Project Folder…', group: 'File', icon: FolderSearch, run: handleOpenProjectFolder } as Command]
      : []),
    { id: 'new-chapter', label: 'New Chapter', group: 'File', icon: PenLine, disabled: !selectedProject, run: () => handleCreateDocument(nextTitle('Chapter')) },
    { id: 'save', label: 'Save Document', group: 'File', icon: Save, disabled: !selectedDocument, run: persistCurrent },
    { id: 'compile', label: 'Compile to PDF Book', group: 'File', icon: FileDown, disabled: !selectedProject, run: () => setIsCompilerOpen(true) },
    { id: 'close-project', label: 'Close Project', group: 'File', icon: X, disabled: !selectedProject, run: handleCloseProject },
    {
      id: 'copy-text',
      label: 'Copy Document Text',
      group: 'Edit',
      icon: Copy,
      disabled: !selectedDocument,
      run: () => {
        if (activeEditor) navigator.clipboard.writeText(activeEditor.getText());
      },
    },
    { id: 'toggle-explorer', label: 'Toggle Explorer', group: 'View', icon: PanelLeft, run: () => setIsLeftSidebarOpen(!isLeftSidebarOpen) },
    { id: 'toggle-format', label: 'Toggle Format Panel', group: 'View', icon: PanelRight, run: () => setIsRightSidebarOpen(!isRightSidebarOpen) },
    { id: 'settings', label: 'Settings', group: 'Tools', icon: Settings, run: () => setIsEditingSettings(true) },
    {
      id: 'smooth-caret',
      label: smoothCaret ? 'Disable Smooth Caret' : 'Enable Smooth Caret',
      group: 'Tools',
      icon: MousePointer2,
      run: () => setSmoothCaret(!smoothCaret),
    },
    { id: 'autosave', label: autoSaveEnabled ? 'Disable Auto-Save' : 'Enable Auto-Save', group: 'Tools', icon: Save, run: () => setAutoSaveEnabled(!autoSaveEnabled) },
    ...themeCommands,
    { id: 'about', label: 'About MnemoScript', group: 'Help', icon: Info, run: () => alert('MnemoScript — a calm, local-first writing studio.') },
  ];

  /** "Chapter 3"-style auto-numbering shared with the sidebar. */
  function nextTitle(kind: string): string {
    const re = new RegExp(`^${kind} (\\d+)$`);
    let max = 0;
    for (const d of documents) {
      const m = d.title.match(re);
      if (m) max = Math.max(max, parseInt(m[1], 10));
    }
    return `${kind} ${max + 1}`;
  }

  const settingsPanel = (
    <SettingsPanel
      theme={theme}
      setTheme={setTheme}
      editorFont={editorFont}
      setEditorFont={setEditorFont}
      editorSize={editorSize}
      setEditorSize={setEditorSize}
      lineHeight={lineHeight}
      setLineHeight={setLineHeight}
      editorPadding={editorPadding}
      setEditorPadding={setEditorPadding}
      spellcheckActive={spellcheckActive}
      setSpellcheckActive={setSpellcheckActive}
      smoothCaret={smoothCaret}
      setSmoothCaret={setSmoothCaret}
      autoSaveInterval={autoSaveInterval}
      setAutoSaveInterval={setAutoSaveInterval}
      defaultSavePath={defaultSavePath}
      setDefaultSavePath={setDefaultSavePath}
      onClose={() => setIsEditingSettings(false)}
    />
  );

  return (
    <div className="h-screen flex flex-col bg-background text-foreground transition-colors duration-300 safe-area-insets">
      {isMobileShell ? (
        <MobileShell
          selectedProject={selectedProject}
          selectedDocument={selectedDocument}
          documents={documents}
          folders={folders}
          projects={projects}
          activeEditor={activeEditor}
          isSaved={isSaved}
          onOpenProject={handleOpenProject}
          onCloseProject={handleCloseProject}
          onNewProject={() => setIsCreateModalOpen(true)}
          onSelectDocument={(doc) => void selectDocument(doc)}
          onCreateDocument={handleCreateDocument}
          onCreateFolder={handleCreateFolder}
          onRenameDocument={handleRenameDocument}
          onDeleteDocuments={handleDeleteDocuments}
          onDuplicateDocuments={handleDuplicateDocuments}
          onMoveDocuments={handleMoveDocuments}
          onUpdateDocumentContent={handleUpdateDocumentContent}
          onEditorReady={setActiveEditor}
          persistCurrent={persistCurrent}
          editorFont={editorFont}
          setEditorFont={setEditorFont}
          editorSize={editorSize}
          setEditorSize={setEditorSize}
          lineHeight={lineHeight}
          setLineHeight={setLineHeight}
          editorPadding={editorPadding}
          spellcheckActive={spellcheckActive}
          setSpellcheckActive={setSpellcheckActive}
          smoothCaret={smoothCaret}
          setSmoothCaret={setSmoothCaret}
          autoSaveInterval={autoSaveInterval}
          setAutoSaveInterval={setAutoSaveInterval}
          theme={theme}
          setTheme={setTheme}
        />
      ) : (
        <>
          <DesktopTopBar
            selectedProject={selectedProject}
            selectedDocument={selectedDocument}
            onOpenPalette={() => setIsPaletteOpen(true)}
            onNew={() => setIsCreateModalOpen(true)}
            onSave={persistCurrent}
            canSave={!!selectedDocument}
            onCompile={() => setIsCompilerOpen(true)}
            canCompile={!!selectedProject}
            showPanelToggles={!!selectedProject && !isEditingSettings}
            isLeftSidebarOpen={isLeftSidebarOpen}
            setIsLeftSidebarOpen={setIsLeftSidebarOpen}
            isRightSidebarOpen={isRightSidebarOpen}
            setIsRightSidebarOpen={setIsRightSidebarOpen}
          />

          {isEditingSettings && !selectedProject ? (
            settingsPanel
          ) : !selectedProject ? (
            <div className="flex-1 flex flex-col items-center justify-center p-8 bg-radial from-background/40 to-background overflow-y-auto">
              <div className="w-full max-w-4xl flex flex-col gap-10">
                {/* Header Title Section */}
                <div className="text-center flex flex-col items-center gap-3">
                  <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center text-primary mb-2 shadow-sm border border-primary/20">
                    <BookOpen className="w-8 h-8" />
                  </div>
                  <h1 className="text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">MnemoScript Studio</h1>
                  <p className="text-md text-muted-foreground max-w-md">A calm, local-first home for your writing.</p>
                </div>

                {/* Quick Actions Panel */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <button
                    onClick={() => setIsCreateModalOpen(true)}
                    className="group p-5 text-left rounded-xl bg-secondary/35 border border-border/40 hover:border-primary/50 hover:bg-secondary/60 transition-all duration-300 shadow-xs cursor-pointer flex gap-4 items-start"
                  >
                    <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary group-hover:scale-110 transition-transform duration-300 shrink-0">
                      <Plus className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="text-base font-medium text-foreground mb-1 group-hover:text-primary transition-colors">New Project</h3>
                      <p className="text-sm text-muted-foreground leading-relaxed">Start a novel, screenplay or notebook, saved on your device.</p>
                    </div>
                  </button>

                  {isTauri && !isMobileOS && (
                    <button
                      onClick={handleOpenProjectFolder}
                      className="group p-5 text-left rounded-xl bg-secondary/35 border border-border/40 hover:border-primary/50 hover:bg-secondary/60 transition-all duration-300 shadow-xs cursor-pointer flex gap-4 items-start"
                    >
                      <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary group-hover:scale-110 transition-transform duration-300 shrink-0">
                        <FolderSearch className="w-5 h-5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="text-base font-medium text-foreground mb-1 group-hover:text-primary transition-colors">Open Folder</h3>
                        <p className="text-sm text-muted-foreground leading-relaxed">Open a project folder from another machine or a backup.</p>
                      </div>
                    </button>
                  )}

                  <button
                    onClick={() => setIsEditingSettings(true)}
                    className="group p-5 text-left rounded-xl bg-secondary/35 border border-border/40 hover:border-primary/50 hover:bg-secondary/60 transition-all duration-300 shadow-xs cursor-pointer flex gap-4 items-start"
                  >
                    <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary group-hover:scale-110 transition-transform duration-300 shrink-0">
                      <Settings className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="text-base font-medium text-foreground mb-1 group-hover:text-primary transition-colors">Settings</h3>
                      <p className="text-sm text-muted-foreground leading-relaxed">Theme, typography, auto-save and storage.</p>
                    </div>
                  </button>
                </div>

                {/* Existing Projects List */}
                {projects.length > 0 && (
                  <div className="flex flex-col gap-4 mt-2">
                    <h3 className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">Recent Projects</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-[300px] overflow-y-auto pr-1">
                      {projects.map((proj) => (
                        <div
                          key={proj.id}
                          className="group relative flex items-center justify-between p-4 text-left rounded-lg bg-secondary/20 border border-border/30 hover:border-primary/45 hover:bg-secondary/45 transition-all duration-200"
                        >
                          <button onClick={() => handleOpenProject(proj)} className="flex items-center gap-3 truncate flex-1 text-left cursor-pointer">
                            <FolderOpen className="w-5 h-5 text-primary/75 group-hover:text-primary transition-colors flex-shrink-0" />
                            <div className="truncate">
                              <h4 className="text-sm font-medium text-foreground group-hover:text-primary transition-colors truncate">{proj.name}</h4>
                              <span className="text-xs text-muted-foreground/70 truncate block">
                                {proj.documents?.length ? `${proj.documents.length} document${proj.documents.length === 1 ? '' : 's'} · ` : ''}
                                <span className="font-mono">{proj.path}</span>
                              </span>
                            </div>
                          </button>
                          <button
                            onClick={() => handleForgetProject(proj)}
                            className="w-7 h-7 flex items-center justify-center rounded-md text-muted-foreground/50 opacity-0 group-hover:opacity-100 hover:bg-secondary hover:text-destructive transition-all cursor-pointer shrink-0"
                            title="Remove from list (keeps the files)"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                          <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:text-primary group-hover:translate-x-1 transition-all duration-250 flex-shrink-0 ml-1" />
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="flex-1 flex overflow-hidden relative">
              {isLeftSidebarOpen &&
                (() => {
                  const sidebar = (
                    <Sidebar
                      selectedProject={selectedProject}
                      selectedDocument={selectedDocument}
                      documents={documents}
                      folders={folders}
                      onCreateDocument={handleCreateDocument}
                      onSelectDocument={(doc) => {
                        void selectDocument(doc);
                        if (isNarrow) setIsLeftSidebarOpen(false);
                      }}
                      onCreateFolder={handleCreateFolder}
                      onRenameFolder={handleRenameFolder}
                      onDeleteFolder={handleDeleteFolder}
                      onMoveDocuments={handleMoveDocuments}
                      onMoveFolder={handleMoveFolder}
                      onRenameDocument={handleRenameDocument}
                      onDeleteDocuments={handleDeleteDocuments}
                      onDuplicateDocuments={handleDuplicateDocuments}
                    />
                  );
                  return isNarrow ? (
                    <Drawer side="left" onClose={() => setIsLeftSidebarOpen(false)}>
                      {sidebar}
                    </Drawer>
                  ) : (
                    sidebar
                  );
                })()}

              {isEditingSettings ? (
                settingsPanel
              ) : !selectedDocument ? (
                <EmptyEditorState onNew={() => handleCreateDocument(nextTitle('Chapter'))} />
              ) : isMindMap ? (
                <MindMap
                  key={selectedDocument.id}
                  document={selectedDocument}
                  onUpdateContent={handleUpdateDocumentContent}
                  onRequestSave={persistCurrent}
                  theme={theme}
                />
              ) : isFantasyMap ? (
                <Suspense fallback={<div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">Loading map studio…</div>}>
                  <FantasyMap
                    key={selectedDocument.id}
                    document={selectedDocument}
                    projectId={selectedProject.id}
                    onUpdateContent={handleUpdateDocumentContent}
                    onRequestSave={persistCurrent}
                    theme={theme}
                  />
                </Suspense>
              ) : (
                <Editor
                  key={selectedDocument.id}
                  projectId={selectedProject.id}
                  document={selectedDocument}
                  onUpdateDocumentContent={handleUpdateDocumentContent}
                  onEditorReady={setActiveEditor}
                  editorFont={editorFont}
                  editorSize={editorSize}
                  lineHeight={lineHeight}
                  editorPadding={editorPadding}
                  spellcheckActive={spellcheckActive}
                  smoothCaret={smoothCaret}
                />
              )}

              {isRightSidebarOpen &&
                !isEditingSettings &&
                isTextDoc &&
                (() => {
                  const panel = (
                    <RightSidebar
                      editor={activeEditor}
                      isOpen={isRightSidebarOpen}
                      theme={theme}
                      editorFont={editorFont}
                      setEditorFont={setEditorFont}
                      editorSize={editorSize}
                      setEditorSize={setEditorSize}
                      lineHeight={lineHeight}
                      setLineHeight={setLineHeight}
                    />
                  );
                  return isNarrow ? (
                    <Drawer side="right" onClose={() => setIsRightSidebarOpen(false)}>
                      {panel}
                    </Drawer>
                  ) : (
                    panel
                  );
                })()}
            </div>
          )}

          {/* Status bar */}
          <footer className="h-6 bg-accent text-accent-foreground flex items-center justify-between px-3 text-xs border-t border-border/40 select-none z-50 transition-colors duration-200">
            <div className="hidden sm:flex items-center gap-2 truncate max-w-[50%]">
              <span className="opacity-70 font-mono truncate">
                {selectedProject ? `${selectedProject.path}${selectedDocument ? ` / ${selectedDocument.title}` : ''}` : 'No project open'}
              </span>
            </div>
            <div className="flex items-center gap-4">
              {saveError ? (
                <span className="flex items-center gap-1.5 text-destructive" title={saveError}>
                  <AlertTriangle className="w-3 h-3" /> Save failed
                </span>
              ) : (
                <span className="flex items-center gap-1.5 opacity-90">
                  <span
                    className={`w-2 h-2 rounded-full ${
                      isSaved ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 'bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.5)] animate-pulse'
                    }`}
                  />
                  {isSaved ? 'Saved' : 'Unsaved changes'}
                </span>
              )}
              {selectedProject && (
                <>
                  <div className="h-3 w-px bg-accent-foreground/20" />
                  {isMindMap ? (
                    <span className="opacity-90">Mind Map</span>
                  ) : isFantasyMap ? (
                    <span className="opacity-90">Fantasy Map</span>
                  ) : selectedDocument ? (
                    <>
                      <span>
                        <strong>{wordCount.toLocaleString()}</strong> words
                      </span>
                      <span>
                        <strong>{charCount.toLocaleString()}</strong> characters
                      </span>
                    </>
                  ) : null}
                </>
              )}
              <button
                className="flex items-center gap-1 bg-primary text-primary-foreground hover:opacity-90 active:scale-95 px-2 py-0.5 rounded text-[11px] font-medium transition-all cursor-pointer disabled:opacity-40"
                disabled={!selectedDocument}
                onClick={persistCurrent}
              >
                <Save className="w-3 h-3" />
                Save
              </button>
            </div>
          </footer>
          {isPaletteOpen && <CommandPalette onClose={() => setIsPaletteOpen(false)} commands={commands} />}
        </>
      )}

      <ProjectCreationModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onProjectCreated={handleProjectCreated}
        defaultSavePath={defaultSavePath}
      />

      {selectedProject && isCompilerOpen && <BookCompiler onClose={() => setIsCompilerOpen(false)} project={selectedProject} documents={documents} />}
    </div>
  );
}

export default App;
