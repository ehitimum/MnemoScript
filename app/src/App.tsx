import { useState, useEffect, useRef, useCallback } from 'react';
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

  // Settings & modal states
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [theme, setTheme] = useState<'dark' | 'light' | 'glass'>('dark');
  const [editorFont, setEditorFont] = useState('Outfit');
  const [editorSize, setEditorSize] = useState(16);

  // Panel states
  const [isLeftSidebarOpen, setIsLeftSidebarOpen] = useState(true);
  const [isRightSidebarOpen, setIsRightSidebarOpen] = useState(true);

  // Editor instances & stats
  const [activeEditor, setActiveEditor] = useState<TipTapEditor | null>(null);
  const [wordCount, setWordCount] = useState(0);
  const [charCount, setCharCount] = useState(0);

  // Save states
  const [isSaved, setIsSaved] = useState(true);
  const [lastSaved, setLastSaved] = useState<string | null>(null);
  const [autoSaveEnabled, setAutoSaveEnabled] = useState(true);
  const [manualSaveRequested, setManualSaveRequested] = useState(0);

  // Additional editor settings
  const [lineHeight, setLineHeight] = useState(1.6);
  const [editorPadding, setEditorPadding] = useState(32);
  const [autoSaveInterval, setAutoSaveInterval] = useState(30);
  const [spellcheckActive, setSpellcheckActive] = useState(true);

  // Compute documents list
  const documents = selectedProject?.documents || [];

  // Update selected document when project changes
  const prevProjectIdRef = useRef<string | null>(null);
  useEffect(() => {
    const prevProjectId = prevProjectIdRef.current;
    const currentProjectId = selectedProject?.id || null;
    if (prevProjectId !== currentProjectId) {
      if (selectedProject && selectedProject.documents.length > 0) {
        // Try to keep same document or default to first
        const existingDoc = selectedProject.documents.find(doc => doc.id === selectedDocument?.id);
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setSelectedDocument(existingDoc || selectedProject.documents[0]);
      } else {
        setSelectedDocument(null);
      }
      setIsSaved(true);
      setLastSaved(null);
    }
    prevProjectIdRef.current = currentProjectId;
  }, [selectedProject, selectedDocument]);

  // Load all registered projects
  const loadProjectsList = useCallback(async () => {
    try {
      const response = await invoke<{ success: boolean; data: Project[]; error?: string }>('list_projects');
      if (response.success) {
        setProjects(response.data || []);
      } else {
        console.error('Failed to load projects list:', response.error);
      }
    } catch (error) {
      console.error('Error loading projects:', error);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadProjectsList();
  }, [loadProjectsList]);

  // Reload current project state to fetch updated lists
  const reloadCurrentProject = async () => {
    if (!selectedProject) return;
    try {
      const response = await invoke<{ success: boolean; data: Project; error?: string }>('load_project', {
        projectId: selectedProject.id,
      });
      if (response.success) {
        setSelectedProject(response.data);
      }
    } catch (error) {
      console.error('Error reloading project:', error);
    }
  };

  const handleCreateDocument = async (title: string) => {
    if (!selectedProject) return;
    try {
      const response = await invoke<{ success: boolean; data: Document; error?: string }>('create_document', {
        projectId: selectedProject.id,
        title: title.trim(),
        content: '<p>Start writing your chapter here...</p>',
      });
      if (response.success) {
        setSelectedDocument(response.data);
        setIsSaved(true);
        setLastSaved(null);
        await reloadCurrentProject();
      } else {
        console.error('Failed to create document:', response.error);
        alert(`Failed to create document: ${response.error}`);
      }
    } catch (error) {
      console.error('Error creating document:', error);
    }
  };

  const handleOpenProjectFolder = async () => {
    try {
      const dirResponse = await invoke<{ success: boolean; data: string | null; error?: string }>('select_directory');
      if (dirResponse.success && dirResponse.data) {
        const projResponse = await invoke<{ success: boolean; data: Project; error?: string }>('open_project_by_path', {
          path: dirResponse.data,
        });
        if (projResponse.success) {
          setSelectedProject(projResponse.data);
          loadProjectsList();
        } else {
          alert(`Failed to open project: ${projResponse.error}`);
        }
      }
    } catch (error) {
      console.error('Error opening project folder:', error);
      alert(`Error: ${error}`);
    }
  };

  const handleProjectCreated = (newProject: Project) => {
    setSelectedProject(newProject);
    loadProjectsList();
  };

  const handleSelectProject = async (project: Project) => {
    try {
      const response = await invoke<{ success: boolean; data: Project; error?: string }>('load_project', {
        projectId: project.id,
      });
      if (response.success) {
        setSelectedProject(response.data);
      } else {
        alert(`Failed to load project: ${response.error}`);
      }
    } catch (error) {
      console.error(error);
    }
  };

  const handleSaveDocumentManual = () => {
    setManualSaveRequested(prev => prev + 1);
  };

  const handleSaveSuccess = (savedTime: string) => {
    setIsSaved(true);
    setLastSaved(savedTime);
    reloadCurrentProject();
  };

  const handleContentDirty = () => {
    setIsSaved(false);
  };

  const handleCloseProject = () => {
    setSelectedProject(null);
    setSelectedDocument(null);
    loadProjectsList();
  };

  const handleCopyText = useCallback(() => {
    if (!activeEditor) return;
    const plainText = activeEditor.getText();
    navigator.clipboard.writeText(plainText)
      .then(() => {
        alert('Plain text copied to clipboard successfully!');
      })
      .catch((err) => {
        console.error('Failed to copy text: ', err);
      });
  }, [activeEditor]);

  return (
    <div className={`app-container theme-${theme}`}>
      <Header
        selectedProject={selectedProject}
        selectedDocument={selectedDocument}
        onCloseProject={handleCloseProject}
        onSaveDocument={handleSaveDocumentManual}
        isSaved={isSaved}
        theme={theme}
        setTheme={setTheme}
        isLeftSidebarOpen={isLeftSidebarOpen}
        setIsLeftSidebarOpen={setIsLeftSidebarOpen}
        isRightSidebarOpen={isRightSidebarOpen}
        setIsRightSidebarOpen={setIsRightSidebarOpen}
        onOpenCreateModal={() => setIsCreateModalOpen(true)}
        onOpenProjectFolder={handleOpenProjectFolder}
        onCopyText={handleCopyText}
        onOpenSettings={() => setIsSettingsOpen(true)}
        autoSaveEnabled={autoSaveEnabled}
        onChangeAutoSave={setAutoSaveEnabled}
      />

      {/* Main Workspace Frame */}
      <div className="workspace-main-area">
        {selectedProject ? (
          <div className="workspace-split">
            {isLeftSidebarOpen && (
              <Sidebar
                selectedProject={selectedProject}
                selectedDocument={selectedDocument}
                documents={documents}
                onCreateDocument={handleCreateDocument}
                onSelectDocument={setSelectedDocument}
              />
            )}
            <main className="editor-pane" style={{ fontFamily: editorFont, fontSize: `${editorSize}px` }}>
              {selectedDocument ? (
                <Editor
                  projectId={selectedProject.id}
                  document={selectedDocument}
                  autoSaveEnabled={autoSaveEnabled}
                  onChangeAutoSave={setAutoSaveEnabled}
                  manualSaveRequested={manualSaveRequested}
                  onSaveSuccess={handleSaveSuccess}
                  onContentDirty={handleContentDirty}
                  onEditorReady={setActiveEditor}
                  onStatsUpdate={(words, chars) => {
                    setWordCount(words);
                    setCharCount(chars);
                  }}
                  isEditingSettings={isSettingsOpen}
                  onCloseSettings={() => setIsSettingsOpen(false)}
                  editorFont={editorFont}
                  setEditorFont={setEditorFont}
                  editorSize={editorSize}
                  setEditorSize={setEditorSize}
                  lineHeight={lineHeight}
                  setLineHeight={setLineHeight}
                  editorPadding={editorPadding}
                  setEditorPadding={setEditorPadding}
                  autoSaveInterval={autoSaveInterval}
                  setAutoSaveInterval={setAutoSaveInterval}
                  spellcheckActive={spellcheckActive}
                  setSpellcheckActive={setSpellcheckActive}
                  theme={theme}
                  setTheme={setTheme}
                />
              ) : (
                <div className="editor-empty-state">
                  <div className="empty-message-card">
                    <span className="empty-icon">📝</span>
                    <h3>No Chapter Active</h3>
                    <p>Select a chapter from the sidebar, or add a new one to begin writing.</p>
                  </div>
                </div>
              )}
            </main>
            <RightSidebar
              editor={activeEditor}
              isOpen={isRightSidebarOpen && selectedDocument !== null}
              editorFont={editorFont}
              setEditorFont={setEditorFont}
              editorSize={editorSize}
              setEditorSize={setEditorSize}
            />
          </div>
        ) : (
          /* Welcome Hub Page */
          <div className="welcome-hub">
            <div className="welcome-hero">
              <span className="hub-badge">Sprint 1 Prototype</span>
              <h1>Welcome to MnemoScript</h1>
              <p className="hero-sub">Craft your narratives, organize your ideas, and let inspiration flow in a beautiful distraction-free editor.</p>
              
              <div className="hub-quick-actions">
                <button className="hub-btn primary" onClick={() => setIsCreateModalOpen(true)}>
                  ✨ Create New Project
                </button>
                <button className="hub-btn secondary" onClick={handleOpenProjectFolder}>
                  📂 Open Project Folder
                </button>
              </div>
            </div>

            <div className="recent-projects-section">
              <div className="section-header">
                <h2>Recent Workspace Projects</h2>
                <span className="project-badge-count">{projects.length} Total</span>
              </div>

              {projects.length === 0 ? (
                <div className="projects-empty-state" onClick={() => setIsCreateModalOpen(true)}>
                  <div className="empty-projects-icon">📁</div>
                  <h3>No Projects Found</h3>
                  <p>You haven't created or loaded any projects yet. Click here to set up your first writing workspace!</p>
                </div>
              ) : (
                <div className="projects-grid">
                  {projects.map((project) => (
                    <div 
                      key={project.id} 
                      className="project-card"
                      onClick={() => handleSelectProject(project)}
                    >
                      <div className="card-top">
                        <span className="folder-symbol">📁</span>
                        <span className="created-date">
                          {new Date(project.created_at).toLocaleDateString(undefined, {
                            year: 'numeric',
                            month: 'short',
                            day: 'numeric',
                          })}
                        </span>
                      </div>
                      <h3 className="project-card-title">{project.name}</h3>
                      <p className="project-card-desc">
                        {project.description || 'No description provided.'}
                      </p>
                      <div className="project-card-footer">
                        <span className="doc-count-tag">
                          📄 {project.documents?.length || 0} Chapters
                        </span>
                        {project.path && (
                          <span className="path-indicator" title={project.path}>
                            📍 Custom Location
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Bottom Status Bar (Blue Zone) */}
      {selectedProject && (
        <div className="vscode-statusbar">
          <div className="statusbar-left">
            <span className="statusbar-item">
              📂 {selectedProject.name} {selectedDocument ? `> 📄 ${selectedDocument.title}` : ''}
            </span>
          </div>

          <div className="statusbar-right">
            {selectedDocument && (
              <>
                <span className="statusbar-item">
                  📝 Words: <strong>{wordCount}</strong>
                </span>
                <span className="statusbar-separator">|</span>
                <span className="statusbar-item">
                  🔤 Chars: <strong>{charCount}</strong>
                </span>
                <span className="statusbar-separator">|</span>
                <button 
                  className="statusbar-btn copy-btn" 
                  onClick={handleCopyText}
                  title="Copy plain text"
                >
                  📋 Copy Text
                </button>
                <span className="statusbar-separator">|</span>
              </>
            )}
            <button 
              className="statusbar-btn save-btn" 
              onClick={handleSaveDocumentManual} 
              title="Save document" 
              disabled={!selectedDocument}
            >
              💾 Save
            </button>
            <span className="statusbar-separator">|</span>
            <span className="statusbar-item">
              {isSaved ? '🟢 Saved' : '🔴 Unsaved Changes'}
            </span>
          </div>
        </div>
      )}

      {/* Creation Modal */}
      <ProjectCreationModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onProjectCreated={handleProjectCreated}
      />
    </div>
  );
}

export default App;