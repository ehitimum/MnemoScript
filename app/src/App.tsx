import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import Sidebar from './components/Sidebar';
import Editor from './components/Editor';
import type { Project, Document } from './types';
import './App.css';

function App() {
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [selectedDocument, setSelectedDocument] = useState<Document | null>(null);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [newDocTitle, setNewDocTitle] = useState('');

  // Load documents when project is selected
  useEffect(() => {
    if (selectedProject) {
      setDocuments(selectedProject.documents);
      if (selectedProject.documents.length > 0) {
        setSelectedDocument(selectedProject.documents[0]);
      } else {
        setSelectedDocument(null);
      }
    } else {
      setDocuments([]);
      setSelectedDocument(null);
    }
  }, [selectedProject]);

  const handleCreateDocument = async () => {
    if (!selectedProject || !newDocTitle.trim()) return;
    try {
      const response = await invoke<{ success: boolean; data: Document; error?: string }>('create_document', {
        projectId: selectedProject.id,
        title: newDocTitle.trim(),
        content: '<p>Start writing...</p>',
      });
      if (response.success) {
        const newDoc = response.data;
        setDocuments([...documents, newDoc]);
        setSelectedDocument(newDoc);
        setNewDocTitle('');
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

  return (
    <div className="app">
      <div className="sidebar">
        <Sidebar onSelectProject={setSelectedProject} />
      </div>
      <div className="main">
        {selectedProject ? (
          <>
            <div className="project-header">
              <h2>{selectedProject.name}</h2>
              <div className="document-create">
                <input
                  type="text"
                  placeholder="New document title"
                  value={newDocTitle}
                  onChange={(e) => setNewDocTitle(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleCreateDocument()}
                />
                <button onClick={handleCreateDocument}>Create Document</button>
              </div>
            </div>
            <div className="document-list">
              <h3>Documents</h3>
              <ul>
                {documents.map((doc) => (
                  <li
                    key={doc.id}
                    className={selectedDocument?.id === doc.id ? 'active' : ''}
                    onClick={() => handleSelectDocument(doc)}
                  >
                    {doc.title}
                    <span className="doc-date">
                      {new Date(doc.updated_at).toLocaleDateString()}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="editor-container">
              {selectedDocument ? (
                <Editor projectId={selectedProject.id} document={selectedDocument} />
              ) : (
                <p>No document selected. Create a new document to start writing.</p>
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