import { useState, useEffect } from 'react';
import Sidebar from './components/Sidebar';
import Editor from './components/Editor';
import Header from './components/Header';
import RightSidebar from './components/RightSidebar';
import ProjectCreationModal from './components/ProjectCreationModal';
import type { Project, Document } from './types';
import type { Editor as TiptapEditor } from '@tiptap/react';
import { Plus, Settings, FolderOpen, ArrowRight, BookOpen, Save } from 'lucide-react';

export type ThemeType = 'dark' | 'light' | 'glass' | 'ocean' | 'forest' | 'sunset';

function App() {
  const [wordCount, setWordCount] = useState(0);
  const [charCount, setCharCount] = useState(0);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [selectedDocument, setSelectedDocument] = useState<Document | null>(null);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [projects, setProjects] = useState<Project[]>(() => {
    try {
      const saved = localStorage.getItem('mnemo_projects');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
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
  const [manualSaveRequested, setManualSaveRequested] = useState(0);
  const [isSaved, setIsSaved] = useState(true);
  const [autoSaveEnabled, setAutoSaveEnabled] = useState(true);

  // Sync state pipelines
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
  useEffect(() => { localStorage.setItem('mnemo_projects', JSON.stringify(projects)); }, [projects]);

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
    setProjects(prev => [...prev, newProj]);
    setSelectedProject(newProj);
    setDocuments([]);
    setSelectedDocument(null);
    setIsCreateModalOpen(false);
  };

  const handleUpdateDocumentContent = (updatedHtml: string) => {
    if (!selectedDocument) return;
    setIsSaved(false);
    
    setSelectedDocument(prev => prev ? { ...prev, content: updatedHtml, updated_at: new Date().toISOString() } : null);
    setDocuments(prevDocs => prevDocs.map(d => d.id === selectedDocument.id ? { ...d, content: updatedHtml, updated_at: new Date().toISOString() } : d));
  };

  const handleCloseProject = () => {
    if (selectedProject) {
      setProjects(prev => prev.map(p => p.id === selectedProject.id ? { ...p, documents } : p));
    }
    setSelectedProject(null);
    setSelectedDocument(null);
  };

  return (
    <div className="h-screen flex flex-col bg-background text-foreground transition-colors duration-300">
      <Header
        selectedProject={selectedProject}
        selectedDocument={selectedDocument}
        onCloseProject={handleCloseProject}
        onSaveDocument={() => { setIsSaved(true); setManualSaveRequested(p => p + 1); } }
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
                  <p className="text-sm text-muted-foreground leading-relaxed">Initialize a new technical writing folder repository on your disk drive.</p>
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
                      onClick={() => {
                        setSelectedProject(proj);
                        setDocuments(proj.documents || []);
                        setSelectedDocument(null);
                        setIsEditingSettings(false);
                      }}
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
              onCreateDocument={(title) => {
                const newDoc: Document = { id: crypto.randomUUID(), title, content: '', updated_at: new Date().toISOString() };
                setDocuments([...documents, newDoc]);
                setSelectedDocument(newDoc);
              }}
              onSelectDocument={(doc) => { setSelectedDocument(doc); setIsEditingSettings(false); }}
            />
          )}

          <Editor
            projectId={selectedProject.id}
            document={selectedDocument}
            autoSaveEnabled={autoSaveEnabled}
            onChangeAutoSave={setAutoSaveEnabled}
            manualSaveRequested={manualSaveRequested}
            onSaveSuccess={() => setIsSaved(true)}
            onContentDirty={() => setIsSaved(false)}
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

          {isRightSidebarOpen && !isEditingSettings && (
            <RightSidebar
              editor={activeEditor}
              isOpen={isRightSidebarOpen}
              theme={theme}
              editorFont={editorFont}
              setEditorFont={setEditorFont}
              editorSize={editorSize}
              setEditorSize={setEditorSize}
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
              <span><strong>{wordCount}</strong> words</span>
              <span><strong>{charCount}</strong> characters</span>
            </>
          )}
          <button 
            className="flex items-center gap-1 bg-primary text-primary-foreground hover:opacity-90 active:scale-95 px-2 py-0.5 rounded text-[11px] font-medium transition-all cursor-pointer"
            disabled={!selectedDocument} 
            onClick={() => { setIsSaved(true); setManualSaveRequested(p => p + 1); }}
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
      />
    </div>
  );
}

export default App;