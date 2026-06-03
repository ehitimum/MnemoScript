import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Editor as TipTapEditor } from '@tiptap/react';
import Sidebar from './components/Sidebar';
import Editor from './components/Editor';
import Header from './components/Header';
import RightSidebar from './components/RightSidebar';
import ProjectCreationModal from './components/ProjectCreationModal';
import type { Project, Document } from './types';
import './App.css';

function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [selectedDocument, setSelectedDocument] = useState<Document | null>(null);
  const [documents, setDocuments] = useState<Document[]>([]);

  // System Setup UI configuration fields
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isEditingSettings, setIsEditingSettings] = useState(false);
  const [theme, setTheme] = useState<'dark' | 'light' | 'glass'>('dark');
  const [editorFont, setEditorFont] = useState('Inter');
  const [editorSize, setEditorSize] = useState(14);
  const [lineHeight, setLineHeight] = useState(1.5);
  const [editorPadding, setEditorPadding] = useState(30);
  const [spellcheckActive, setSpellcheckActive] = useState(true);
  const [autoSaveInterval, setAutoSaveInterval] = useState(30);
  const [defaultSavePath, setDefaultSavePath] = useState('~/.mnemoscript/projects');

  // Layout parameters
  const [isLeftSidebarOpen, setIsLeftSidebarOpen] = useState(true);
  const [isRightSidebarOpen, setIsRightSidebarOpen] = useState(true);

  // Synchronization variables
  const [activeEditor, setActiveEditor] = useState<TipTapEditor | null>(null);
  const [manualSaveRequested, setManualSaveRequested] = useState(0);
  const [isSaved, setIsSaved] = useState(true);
  const [autoSaveEnabled, setAutoSaveEnabled] = useState(true);

  useEffect(() => {
    document.body.className = `theme-${theme}`;
  }, [theme]);

  const handleOpenProjectFolder = async () => {
    try {
      const response = await invoke<{ success: boolean; data: Project | null }>('select_directory');
      if (response.success && response.data) {
        setSelectedProject(response.data);
        setIsEditingSettings(false);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleProjectCreated = (newProj: Project) => {
    setProjects([newProj, ...projects]);
    setSelectedProject(newProj);
    setIsCreateModalOpen(false);
    setIsEditingSettings(false);
  };

  const handleCreateDocument = (title: string) => {
    const newDoc: Document = {
      id: crypto.randomUUID(),
      title,
      content: '',
      updated_at: new Date().toISOString()
    };
    const updated = [...documents, newDoc];
    setDocuments(updated);
    setSelectedDocument(newDoc);
  };

  const handleSaveDocumentManual = () => {
    if (!selectedDocument) return;
    setManualSaveRequested(prev => prev + 1);
  };

  const handleSaveSuccess = () => {
    setIsSaved(true);
  };

  const handleContentDirty = useCallback(() => {
    setIsSaved(false);
  }, []);

  return (
    <div className="app-container">
      <Header
        selectedProject={selectedProject}
        selectedDocument={selectedDocument}
        onCloseProject={() => { setSelectedProject(null); setSelectedDocument(null); }}
        onSaveDocument={handleSaveDocumentManual}
        theme={theme}
        setTheme={setTheme}
        isLeftSidebarOpen={isLeftSidebarOpen}
        setIsLeftSidebarOpen={setIsLeftSidebarOpen}
        isRightSidebarOpen={isRightSidebarOpen}
        setIsRightSidebarOpen={setIsRightSidebarOpen}
        onOpenCreateModal={() => setIsCreateModalOpen(true)}
        onOpenProjectFolder={handleOpenProjectFolder}
        onCopyText={() => { if(activeEditor) navigator.clipboard.writeText(activeEditor.getText()); }}
        onOpenSettings={() => setIsEditingSettings(true)}
        autoSaveEnabled={autoSaveEnabled}
        onChangeAutoSave={setAutoSaveEnabled}
      />

      {!selectedProject ? (
        <div className="landing-dashboard">
          <div className="dashboard-start-column">
            <h2 className="dashboard-title">MnemoScript IDE Engine</h2>
            <p className="dashboard-subtitle">Start a clean system-controlled environment</p>
            <button className="dashboard-action-link-btn" onClick={() => setIsCreateModalOpen(true)}>
              ✨ Create New Managed Project
            </button>
            <button className="dashboard-action-link-btn" onClick={handleOpenProjectFolder}>
              📂 Mount Existing Repository Folder
            </button>
            <button className="dashboard-action-link-btn" onClick={() => setIsEditingSettings(true)}>
              ⚙️ View Environment Preferences
            </button>
          </div>
          <div className="dashboard-recent-column">
            <h2 className="dashboard-title">Recent Workspaces</h2>
            <div className="recent-projects-list">
              <div className="recent-project-card" onClick={() => handleProjectCreated({
                id: '1', name: 'My Core Deep Work Novel', path: '/home/usr/docs',
                created_at: '',
                documents: []
              })}>
                <div className="recent-project-name">My Core Deep Work Novel</div>
                <div className="recent-project-path">/home/usr/docs/my-novel</div>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="main-workspace">
          {isLeftSidebarOpen && (
            <Sidebar
              selectedProject={selectedProject}
              selectedDocument={selectedDocument}
              documents={documents}
              onCreateDocument={handleCreateDocument}
              onSelectDocument={(doc) => { setSelectedDocument(doc); setIsEditingSettings(false); }}
            />
          )}

          <Editor
            projectId={selectedProject.id}
            document={selectedDocument}
            autoSaveEnabled={autoSaveEnabled}
            onChangeAutoSave={setAutoSaveEnabled}
            manualSaveRequested={manualSaveRequested}
            onSaveSuccess={handleSaveSuccess}
            onContentDirty={handleContentDirty}
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

      {/* Rigid Bottom Blue Zone Status Bar */}
      <footer className="vscode-statusbar">
        <div className="statusbar-left">
          <span className="statusbar-path">
            {selectedProject ? `${selectedProject.path}/${selectedDocument ? selectedDocument.title : ''}` : 'No active workspace'}
          </span>
        </div>
        <div className="statusbar-right">
          <span>{isSaved ? '● Synced' : '○ Modified Changes'}</span>
          <button 
            className="statusbar-manual-save-btn"
            disabled={!selectedDocument}
            onClick={handleSaveDocumentManual}
          >
            Save Document
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