import { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import Sidebar from './components/Sidebar';
import Editor from './components/Editor';
import type { Project, Document } from './types';
import './App.css';

function App() {
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [selectedDocument, setSelectedDocument] = useState<Document | null>(null);

  // Compute documents based on selected project
  const documents = selectedProject?.documents || [];

  // Update selected document when project changes
  const prevProjectIdRef = useRef<string | null>(null);
  useEffect(() => {
    const prevProjectId = prevProjectIdRef.current;
    const currentProjectId = selectedProject?.id || null;
    if (prevProjectId !== currentProjectId) {
      // Project changed
      if (selectedProject && selectedProject.documents.length > 0) {
        // Try to keep the same document if it exists in new project
        const existingDoc = selectedProject.documents.find(doc => doc.id === selectedDocument?.id);
        if (existingDoc) {
          // eslint-disable-next-line react-hooks/set-state-in-effect
          setSelectedDocument(existingDoc);
        } else {
          // eslint-disable-next-line react-hooks/set-state-in-effect
          setSelectedDocument(selectedProject.documents[0]);
        }
      } else {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setSelectedDocument(null);
      }
    }
    prevProjectIdRef.current = currentProjectId;
  }, [selectedProject, selectedDocument]);

  const handleCreateDocument = async (title: string) => {
    if (!selectedProject) return;
    try {
      const response = await invoke<{ success: boolean; data: Document; error?: string }>('create_document', {
        projectId: selectedProject.id,
        title: title.trim(),
        content: '<p>Start writing...</p>',
      });
      if (response.success) {
        const newDoc = response.data;
        setSelectedDocument(newDoc);
        // Reload project to update documents list
        const projectResponse = await invoke<{ success: boolean; data: Project; error?: string }>('load_project', {
          projectId: selectedProject.id,
        });
        if (projectResponse.success) {
          setSelectedProject(projectResponse.data);
        }
      } else {
        console.error('Failed to create document:', response.error);
      }
    } catch (error) {
      console.error('Error creating document:', error);
    }
  };

  const handleSelectDocument = (doc: Document) => {
    setSelectedDocument(doc);
  };

  const handleBack = () => {
    setSelectedProject(null);
  };

  return (
    <div className="app">
      <div className="sidebar">
        <Sidebar
          selectedProject={selectedProject}
          selectedDocument={selectedDocument}
          documents={documents}
          onSelectProject={setSelectedProject}
          onBack={handleBack}
          onCreateDocument={handleCreateDocument}
          onSelectDocument={handleSelectDocument}
        />
      </div>
      <div className="main">
        {selectedProject ? (
          <>
            <div className="project-header">
              <h2>{selectedProject.name}</h2>
              {selectedProject.description && (
                <p className="project-description">{selectedProject.description}</p>
              )}
            </div>
            <div className="editor-container">
              {selectedDocument ? (
                <Editor projectId={selectedProject.id} document={selectedDocument} />
              ) : (
                <p>Select a chapter from the sidebar or create a new one to start writing.</p>
              )}
            </div>
          </>
        ) : (
          <div className="welcome">
            <h1>Welcome to MnemoScript</h1>
            <p>Select a project from the sidebar or create a new one to start writing.</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;