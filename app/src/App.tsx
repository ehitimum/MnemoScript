import { useState, useEffect, useRef, useCallback } from 'react';
import Sidebar from './components/Sidebar';
import Editor from './components/Editor';
import MindMap from './components/MindMap';
import Header from './components/Header';
import RightSidebar from './components/RightSidebar';
import ProjectCreationModal from './components/ProjectCreationModal';
import BookCompiler from './components/BookCompiler';
import { api } from './lib/api';
import type { Project, Document, DocType, Folder } from './types';
import type { Editor as TiptapEditor } from '@tiptap/react';
import { Plus, Settings, FolderOpen, ArrowRight, BookOpen, Save } from 'lucide-react';

export type ThemeType = 'dark' | 'light' | 'glass' | 'ocean' | 'forest' | 'sunset';

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

  const [theme, setTheme] = useState<ThemeType>(() => (localStorage.getItem('mnemo_theme') as ThemeType) || 'dark');
  const [editorFont, setEditorFont] = useState(() => localStorage.getItem('mnemo_font') || 'Inter');
  const [editorSize, setEditorSize] = useState(() => Number(localStorage.getItem('mnemo_size')) || 14);
  const [lineHeight, setLineHeight] = useState(() => Number(localStorage.getItem('mnemo_lineheight')) || 1.5);
  const [editorPadding, setEditorPadding] = useState(() => Number(localStorage.getItem('mnemo_padding')) || 30);
  const [spellcheckActive, setSpellcheckActive] = useState(() => localStorage.getItem('mnemo_spellcheck') !== 'false');
  const [autoSaveInterval, setAutoSaveInterval] = useState(() => Number(localStorage.getItem('mnemo_interval')) || 30);
  const [defaultSavePath, setDefaultSavePath] = useState(() => localStorage.getItem('mnemo_path') || 'C:/Users/Documents/MnemoScript');

  const [isLeftSidebarOpen, setIsLeftSidebarOpen] = useState(true);
  const [isRightSidebarOpen, setIsRightSidebarOpen] = useState(true);

  const [activeEditor, setActiveEditor] = useState<TiptapEditor | null>(null);
  const [isSaved, setIsSaved] = useState(true);
  const [autoSaveEnabled, setAutoSaveEnabled] = useState(true);

  const isMindMap = selectedDocument?.docType === 'mindmap';

  // Load all projects from disk on startup (metadata only; documents are loaded on open).
  useEffect(() => {
    api.listProjects()
      .then(setProjects)
      .catch((e) => console.error('Failed to list projects:', e));
  }, []);

  // Sync UI-preference state to localStorage (projects/documents live on disk via the backend).
  useEffect(() => {
    localStorage.setItem('mnemo_theme', theme);
    document.body.className = `theme-${theme}`;
  }, [theme]);
  useEffect(() => { localStorage.setItem('mnemo_font', editorFont); }, [editorFont]);
  useEffect(() => { localStorage.setItem('mnemo_size', String(editorSize)); }, [editorSize]);
  useEffect(() => { localStorage.setItem('mnemo_lineheight', String(lineHeight)); }, [lineHeight]);
  useEffect(() => { localStorage.setItem('mnemo_padding', String(editorPadding)); }, [editorPadding]);
  useEffect(() => { localStorage.setItem('mnemo_spellcheck', String(spellcheckActive)); }, [spellcheckActive]);
  useEffect(() => { localStorage.setItem('mnemo_interval', String(autoSaveInterval)); }, [autoSaveInterval]);
  useEffect(() => { localStorage.setItem('mnemo_path', defaultSavePath); }, [defaultSavePath]);

  // ── Persistence: keep refs of the live doc/project/dirty flag so the auto-save
  // interval and manual-save handlers always read current values (no stale closures).
  const selectedProjectRef = useRef(selectedProject);
  const selectedDocumentRef = useRef(selectedDocument);
  const isSavedRef = useRef(isSaved);
  useEffect(() => { selectedProjectRef.current = selectedProject; }, [selectedProject]);
  useEffect(() => { selectedDocumentRef.current = selectedDocument; }, [selectedDocument]);
  useEffect(() => { isSavedRef.current = isSaved; }, [isSaved]);

  const persistCurrent = useCallback(async () => {
    const proj = selectedProjectRef.current;
    const doc = selectedDocumentRef.current;
    if (!proj || !doc) return;
    try {
      await api.saveDocument(proj.id, doc);
      setIsSaved(true);
    } catch (e) {
      console.error('Save failed:', e);
    }
  }, []);

  // Auto-save loop: persists the open document whenever it is dirty.
  useEffect(() => {
    if (!autoSaveEnabled) return;
    const id = setInterval(() => {
      if (!isSavedRef.current) persistCurrent();
    }, Math.max(5, autoSaveInterval) * 1000);
    return () => clearInterval(id);
  }, [autoSaveEnabled, autoSaveInterval, persistCurrent]);

  useEffect(() => {
    if (!activeEditor) {
      setTimeout(() => {
        setWordCount(0);
        setCharCount(0);
      }, 0);
      return;
    }

    const updateStats = () => {
      const text = activeEditor.getText();
      const words = text.trim().split(/\s+/).filter((w: string) => w.length > 0).length;
      const totalCharsWithoutSpaces = text.replace(/\s/g, '').length;
      
      setWordCount(words);
      setCharCount(totalCharsWithoutSpaces);
    };

    updateStats();
    activeEditor.on('update', updateStats);
    return () => {
      activeEditor.off('update', updateStats);
    };
  }, [activeEditor]);

  const handleProjectCreated = (newProj: Project) => {
    setProjects(prev => [newProj, ...prev.filter(p => p.id !== newProj.id)]);
    setSelectedProject(newProj);
    setDocuments(newProj.documents || []);
    setFolders(newProj.folders || []);
    setSelectedDocument(null);
    setIsCreateModalOpen(false);
  };

  // Load a project's documents from disk before opening it.
  const handleOpenProject = async (proj: Project) => {
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
    setSelectedDocument(null);
    setIsEditingSettings(false);
  };

  const handleCreateDocument = async (
    title: string,
    docType: DocType = 'text',
    folderId: string | null = null,
  ) => {
    if (!selectedProject) return;
    const initialContent = docType === 'mindmap' ? '{"nodes":[],"edges":[]}' : '';
    try {
      const created = await api.createDocument(selectedProject.id, title, initialContent, docType, documents.length);
      // The backend `create_document` command doesn't take a folder; if the doc
      // is meant to live inside a directory, stamp it and persist once more.
      let newDoc = created;
      if (folderId) {
        newDoc = { ...created, folderId };
        await api.saveDocument(selectedProject.id, newDoc);
      }
      setDocuments(prev => [...prev, newDoc]);
      setSelectedDocument(newDoc);
      setIsEditingSettings(false);
    } catch (e) {
      console.error('Failed to create document:', e);
    }
  };

  /** Persist the folder tree (folders live in project.json, saved via save_project). */
  const persistFolders = useCallback(async (nextFolders: Folder[]) => {
    setFolders(nextFolders);
    if (!selectedProject) return;
    const updated = { ...selectedProject, folders: nextFolders, documents };
    setSelectedProject(updated);
    try {
      await api.saveProject(updated);
    } catch (e) {
      console.error('Failed to save folders:', e);
    }
  }, [selectedProject, documents]);

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
    persistFolders(folders.map(f => (f.id === id ? { ...f, name: name.trim() || f.name } : f)));
  };

  /** Delete a folder, lifting its child folders and documents up to its parent. */
  const handleDeleteFolder = async (id: string) => {
    if (!selectedProject) return;
    const target = folders.find(f => f.id === id);
    const newParent = target?.parentId ?? null;

    const nextFolders = folders
      .filter(f => f.id !== id)
      .map(f => (f.parentId === id ? { ...f, parentId: newParent } : f));

    // Reassign documents in this folder to the parent and persist each.
    const movedDocs = documents.filter(d => (d.folderId ?? null) === id);
    const nextDocs = documents.map(d =>
      (d.folderId ?? null) === id ? { ...d, folderId: newParent } : d,
    );
    setDocuments(nextDocs);
    try {
      await Promise.all(movedDocs.map(d => api.saveDocument(selectedProject.id, { ...d, folderId: newParent })));
    } catch (e) {
      console.error('Failed to reassign documents on folder delete:', e);
    }
    persistFolders(nextFolders);
  };

  const handleMoveDocuments = async (docIds: string[], folderId: string | null) => {
    if (!selectedProject) return;
    const idSet = new Set(docIds);
    const moved = documents
      .filter(d => idSet.has(d.id) && (d.folderId ?? null) !== folderId)
      .map(d => ({ ...d, folderId }));
    if (moved.length === 0) return;
    const movedById = new Map(moved.map(d => [d.id, d]));
    setDocuments(prev => prev.map(d => movedById.get(d.id) ?? d));
    if (selectedDocument && movedById.has(selectedDocument.id)) {
      setSelectedDocument(movedById.get(selectedDocument.id)!);
    }
    try {
      await Promise.all(moved.map(d => api.saveDocument(selectedProject.id, d)));
    } catch (e) {
      console.error('Failed to move documents:', e);
    }
  };

  const handleRenameDocument = async (docId: string, title: string) => {
    if (!selectedProject) return;
    const doc = documents.find(d => d.id === docId);
    const trimmed = title.trim();
    if (!doc || !trimmed || trimmed === doc.title) return;
    const renamed = { ...doc, title: trimmed, updated_at: new Date().toISOString() };
    setDocuments(prev => prev.map(d => (d.id === docId ? renamed : d)));
    if (selectedDocument?.id === docId) setSelectedDocument(renamed);
    try {
      await api.saveDocument(selectedProject.id, renamed);
    } catch (e) {
      console.error('Failed to rename document:', e);
    }
  };

  const handleDeleteDocuments = async (docIds: string[]) => {
    if (!selectedProject) return;
    const idSet = new Set(docIds);
    setDocuments(prev => prev.filter(d => !idSet.has(d.id)));
    if (selectedDocument && idSet.has(selectedDocument.id)) setSelectedDocument(null);
    try {
      await Promise.all(docIds.map(id => api.deleteDocument(selectedProject.id, id)));
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
    const sources = documents.filter(d => idSet.has(d.id));
    try {
      const created: Document[] = [];
      for (const src of sources) {
        const target = folderId === undefined ? (src.folderId ?? null) : folderId;
        const copy = await api.createDocument(
          selectedProject.id,
          `${src.title} copy`,
          src.content,
          src.docType,
          documents.length + created.length,
        );
        const placed = { ...copy, folderId: target };
        await api.saveDocument(selectedProject.id, placed);
        created.push(placed);
      }
      setDocuments(prev => [...prev, ...created]);
    } catch (e) {
      console.error('Failed to duplicate documents:', e);
    }
  };

  /** True if `maybeAncestorId` is `folderId` itself or one of its ancestors. */
  const isFolderAncestor = useCallback((folderId: string, maybeAncestorId: string): boolean => {
    let current: string | null | undefined = folderId;
    while (current) {
      if (current === maybeAncestorId) return true;
      current = folders.find(f => f.id === current)?.parentId ?? null;
    }
    return false;
  }, [folders]);

  const handleMoveFolder = (folderId: string, newParentId: string | null) => {
    if (folderId === newParentId) return;
    // Prevent dropping a folder into itself or one of its own descendants.
    if (newParentId && isFolderAncestor(newParentId, folderId)) return;
    persistFolders(folders.map(f => (f.id === folderId ? { ...f, parentId: newParentId } : f)));
  };

  const handleUpdateDocumentContent = (updatedContent: string) => {
    if (!selectedDocument) return;
    setIsSaved(false);

    const stamped = { ...selectedDocument, content: updatedContent, updated_at: new Date().toISOString() };
    setSelectedDocument(stamped);
    selectedDocumentRef.current = stamped;
    setDocuments(prevDocs => prevDocs.map(d => d.id === stamped.id ? stamped : d));
  };

  const handleCloseProject = async () => {
    if (!isSavedRef.current) await persistCurrent();
    setSelectedProject(null);
    setSelectedDocument(null);
    setDocuments([]);
    setFolders([]);
    // Refresh the project list so the welcome screen reflects any new projects.
    api.listProjects().then(setProjects).catch(() => {});
  };

  return (
    <div className="h-screen flex flex-col bg-background text-foreground transition-colors duration-300">
      <Header
        selectedProject={selectedProject}
        selectedDocument={selectedDocument}
        onCloseProject={handleCloseProject}
        onSaveDocument={persistCurrent}
        onCompileBook={() => setIsCompilerOpen(true)}
        setTheme={setTheme}
        isLeftSidebarOpen={isLeftSidebarOpen}
        setIsLeftSidebarOpen={setIsLeftSidebarOpen}
        isRightSidebarOpen={isRightSidebarOpen}
        setIsRightSidebarOpen={setIsRightSidebarOpen}
        onOpenCreateModal={() => setIsCreateModalOpen(true)}
        onOpenProjectFolder={() => setIsCreateModalOpen(true)}
        onCopyText={() => { if (activeEditor) navigator.clipboard.writeText(activeEditor.getText()); } }
        onOpenSettings={() => setIsEditingSettings(true)}
        autoSaveEnabled={autoSaveEnabled}
        onChangeAutoSave={setAutoSaveEnabled} 
        theme={theme}      
      />

      {!selectedProject ? (
        <div className="flex-1 flex flex-col items-center justify-center p-8 bg-radial from-background/40 to-background overflow-y-auto">
          <div className="w-full max-w-4xl flex flex-col gap-10">
            {/* Header Title Section */}
            <div className="text-center flex flex-col items-center gap-3">
              <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center text-primary mb-2 shadow-sm border border-primary/20">
                <BookOpen className="w-8 h-8" />
              </div>
              <h1 className="text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
                MnemoScript Studio
              </h1>
              <p className="text-md text-muted-foreground max-w-md">
                A premium, local-first workspace environment designed for modern writers.
              </p>
            </div>

            {/* Quick Actions Panel */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <button 
                onClick={() => setIsCreateModalOpen(true)}
                className="group p-6 text-left rounded-xl bg-secondary/35 border border-border/40 hover:border-primary/50 hover:bg-secondary/60 transition-all duration-300 shadow-xs cursor-pointer flex gap-4 items-start"
              >
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary group-hover:scale-110 transition-transform duration-300">
                  <Plus className="w-5 h-5" />
                </div>
                <div className="flex-1">
                  <h3 className="text-lg font-medium text-foreground mb-1 group-hover:text-primary transition-colors">Create New Project</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">Start a fresh novel, screenplay, or notebook — saved locally on your device.</p>
                </div>
              </button>

              <button 
                onClick={() => setIsEditingSettings(true)}
                className="group p-6 text-left rounded-xl bg-secondary/35 border border-border/40 hover:border-primary/50 hover:bg-secondary/60 transition-all duration-300 shadow-xs cursor-pointer flex gap-4 items-start"
              >
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary group-hover:scale-110 transition-transform duration-300">
                  <Settings className="w-5 h-5" />
                </div>
                <div className="flex-1">
                  <h3 className="text-lg font-medium text-foreground mb-1 group-hover:text-primary transition-colors">Workspace Settings</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">Customize default paths, auto-save timers, editor scales, and global color profiles.</p>
                </div>
              </button>
            </div>

            {/* Existing Projects List */}
            {projects.length > 0 && (
              <div className="flex flex-col gap-4 mt-2">
                <h3 className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
                  Recent Workspace Projects
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-h-[280px] overflow-y-auto pr-1">
                  {projects.map(proj => (
                    <button 
                      key={proj.id}
                      onClick={() => handleOpenProject(proj)}
                      className="group flex items-center justify-between p-4 text-left rounded-lg bg-secondary/20 border border-border/30 hover:border-primary/45 hover:bg-secondary/45 transition-all duration-200 cursor-pointer"
                    >
                      <div className="flex items-center gap-3 truncate">
                        <FolderOpen className="w-5 h-5 text-primary/75 group-hover:text-primary transition-colors flex-shrink-0" />
                        <div className="truncate">
                          <h4 className="text-sm font-medium text-foreground group-hover:text-primary transition-colors truncate">{proj.name}</h4>
                          <span className="text-xs text-muted-foreground/70 font-mono truncate block">{proj.path}</span>
                        </div>
                      </div>
                      <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:text-primary group-hover:translate-x-1 transition-all duration-250 flex-shrink-0" />
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="flex-1 flex overflow-hidden relative">
          {isLeftSidebarOpen && (
            <Sidebar
              selectedProject={selectedProject}
              selectedDocument={selectedDocument}
              documents={documents}
              folders={folders}
              onCreateDocument={handleCreateDocument}
              onSelectDocument={(doc) => { setSelectedDocument(doc); setIsEditingSettings(false); }}
              onCreateFolder={handleCreateFolder}
              onRenameFolder={handleRenameFolder}
              onDeleteFolder={handleDeleteFolder}
              onMoveDocuments={handleMoveDocuments}
              onMoveFolder={handleMoveFolder}
              onRenameDocument={handleRenameDocument}
              onDeleteDocuments={handleDeleteDocuments}
              onDuplicateDocuments={handleDuplicateDocuments}
            />
          )}

          {isMindMap && selectedDocument && !isEditingSettings ? (
            <MindMap
              key={selectedDocument.id}
              document={selectedDocument}
              onUpdateContent={handleUpdateDocumentContent}
              onRequestSave={persistCurrent}
              theme={theme}
            />
          ) : (
            <Editor
              projectId={selectedProject.id}
              document={selectedDocument}
              onUpdateDocumentContent={handleUpdateDocumentContent}
              onEditorReady={setActiveEditor}
              isEditingSettings={isEditingSettings}
              onCloseSettings={() => setIsEditingSettings(false)}
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
              autoSaveInterval={autoSaveInterval}
              setAutoSaveInterval={setAutoSaveInterval}
              defaultSavePath={defaultSavePath}
              setDefaultSavePath={setDefaultSavePath}
              theme={theme}
              setTheme={setTheme}
            />
          )}

          {isRightSidebarOpen && !isEditingSettings && !isMindMap && (
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
          )}
        </div>
      )}

      {/* VSCode-inspired Status Bar */}
      <footer className="h-6 bg-accent text-accent-foreground flex items-center justify-between px-3 text-xs border-t border-border/40 select-none z-50 transition-colors duration-200">
        <div className="flex items-center gap-2 truncate max-w-[50%]">
          <span className="opacity-70 font-mono truncate">
            {selectedProject ? `${selectedProject.path}/${selectedDocument ? selectedDocument.title : ''}` : 'No workspace mounted'}
          </span>
        </div>
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1.5 opacity-90">
            <span className={`w-2 h-2 rounded-full ${isSaved ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 'bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.5)] animate-pulse'}`} />
            {isSaved ? 'Synced' : 'Changes Detected'}
          </span>
          {selectedProject && (
            <>
              <div className="h-3 w-px bg-accent-foreground/20" />
              {isMindMap ? (
                <span className="opacity-90">Mind Map Canvas</span>
              ) : (
                <>
                  <span><strong>{wordCount}</strong> words</span>
                  <span><strong>{charCount}</strong> characters</span>
                </>
              )}
            </>
          )}
          <button
            className="flex items-center gap-1 bg-primary text-primary-foreground hover:opacity-90 active:scale-95 px-2 py-0.5 rounded text-[11px] font-medium transition-all cursor-pointer disabled:opacity-40"
            disabled={!selectedDocument}
            onClick={persistCurrent}
          >
            <Save className="w-3 h-3" />
            Save Target
          </button>
        </div>
      </footer>

      <ProjectCreationModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onProjectCreated={handleProjectCreated}
        defaultSavePath={defaultSavePath}
      />

      {selectedProject && isCompilerOpen && (
        <BookCompiler
          onClose={() => setIsCompilerOpen(false)}
          project={selectedProject}
          documents={documents}
        />
      )}
    </div>
  );
}

export default App;