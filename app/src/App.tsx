import { useState, useEffect } from 'react';
import Sidebar from './components/Sidebar';
import Editor from './components/Editor';
import Header from './components/Header';
import RightSidebar from './components/RightSidebar';
import ProjectCreationModal from './components/ProjectCreationModal';
import type { Project, Document } from './types';
import './App.css';

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

  // PERSISTENCE UPGRADE: Reading values dynamically from localStorage initialization vectors
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isEditingSettings, setIsEditingSettings] = useState(false);
  
  const [theme, setTheme] = useState<'dark' | 'light' | 'glass'>(() => (localStorage.getItem('mnemo_theme') as any) || 'dark');
  const [editorFont, setEditorFont] = useState(() => localStorage.getItem('mnemo_font') || 'Inter');
  const [editorSize, setEditorSize] = useState(() => Number(localStorage.getItem('mnemo_size')) || 14);
  const [lineHeight, setLineHeight] = useState(() => Number(localStorage.getItem('mnemo_lineheight')) || 1.5);
  const [editorPadding, setEditorPadding] = useState(() => Number(localStorage.getItem('mnemo_padding')) || 30);
  const [spellcheckActive, setSpellcheckActive] = useState(() => localStorage.getItem('mnemo_spellcheck') !== 'false');
  const [autoSaveInterval, setAutoSaveInterval] = useState(() => Number(localStorage.getItem('mnemo_interval')) || 30);
  const [defaultSavePath, setDefaultSavePath] = useState(() => localStorage.getItem('mnemo_path') || 'C:/Users/Documents/MnemoScript');

  const [isLeftSidebarOpen, setIsLeftSidebarOpen] = useState(true);
  const [isRightSidebarOpen, setIsRightSidebarOpen] = useState(true);

  const [activeEditor, setActiveEditor] = useState<any>(null);
  const [manualSaveRequested, setManualSaveRequested] = useState(0);
  const [isSaved, setIsSaved] = useState(true);
  const [autoSaveEnabled, setAutoSaveEnabled] = useState(true);

  // Sync state writing pipelines back to local disk caches
  useEffect(() => { localStorage.setItem('mnemo_theme', theme); document.body.className = `theme-${theme}`; }, [theme]);
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
      setWordCount(0);
      setCharCount(0);
      return;
    }

    const updateStats = () => {
      const text = activeEditor.getText();
      const words = text.trim().split(/\s+/).filter((w: string) => w.length > 0).length;
      
      // Strips all whitespace characters/tabs/newlines from calculation length metric
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

  // Direct content mutations state binding sync logic implementation loop
  const handleUpdateDocumentContent = (updatedHtml: string) => {
    if (!selectedDocument) return;
    setIsSaved(false);
    
    // Mutation target synchronization updates
    setSelectedDocument(prev => prev ? { ...prev, content: updatedHtml, updatedAt: new Date().toISOString() } : null);
    setDocuments(prevDocs => prevDocs.map(d => d.id === selectedDocument.id ? { ...d, content: updatedHtml, updatedAt: new Date().toISOString() } : d));
  };

  const handleCloseProject = () => {
    if (selectedProject) {
      setProjects(prev => prev.map(p => p.id === selectedProject.id ? { ...p, documents } : p));
    }
    setSelectedProject(null);
    setSelectedDocument(null);
  };

  return (
    <div className="app-container">
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
        onChangeAutoSave={setAutoSaveEnabled} theme={'dark'}      />

      {!selectedProject ? (
        <div className="landing-dashboard">
          <div className="dashboard-start-column">
            <h2 className="dashboard-title">MnemoScript Studio Engine</h2>

            <button className="dashboard-action-link-btn" onClick={() => setIsCreateModalOpen(true)}>
              ✨ New Technical Repository Target Project...
            </button>
            <button className="dashboard-action-link-btn" onClick={() => setIsEditingSettings(true)}>
              ⚙️ Modify Global Environment Workspace Settings...
            </button>
            {projects.length > 0 && (
              <div className="dashboard-projects-section" style={{ width: '100%', maxWidth: '400px', margin: '20px 0' }}>
                <h3 style={{ fontSize: '0.8rem', opacity: 0.6, marginBottom: '10px', textTransform: 'uppercase' }}>Existing Projects</h3>
                <div className="projects-scroll-list" style={{ maxHeight: '250px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px', paddingRight: '8px' }}>
                  {projects.map(proj => (
                    <button 
                      key={proj.id} 
                      className="dashboard-project-item-btn"
                      onClick={() => {
                        setSelectedProject(proj);
                        setDocuments(proj.documents || []);
                        setSelectedDocument(null);
                        setIsEditingSettings(false);
                      }}
                      style={{ textAlign: 'left', padding: '12px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '4px', cursor: 'pointer', color: 'inherit' }}
                    >
                      <div style={{ fontWeight: 'bold' }}>{proj.name}</div>
                      <div style={{ fontSize: '0.7rem', opacity: 0.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{proj.path}</div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="main-workspace">
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
              editorFont={editorFont}
              setEditorFont={setEditorFont}
              editorSize={editorSize}
              setEditorSize={setEditorSize}
            />
          )}
        </div>
      )}

      <footer className="vscode-statusbar">
        <div className="statusbar-left">
          <span className="statusbar-path">
            {selectedProject ? `${selectedProject.path}/${selectedDocument ? selectedDocument.title : ''}` : 'No mounted directory workspace path target'}
          </span>
        </div>
        <div className="statusbar-right">
          <span>{isSaved ? '● Saved Sync' : '○ Changes Detected'}</span>
          <button 
            className="statusbar-manual-save-btn" 
            disabled={!selectedDocument} 
            onClick={() => setIsSaved(true)}
          >
            Save Target
          </button>
          {selectedProject && (
            <>
              <span className="stat-label">Words</span>
              <strong>{wordCount}</strong>
              <span className="stat-label">Characters (Text Only)</span>
              <strong>{charCount}</strong>
            </>
          )}
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