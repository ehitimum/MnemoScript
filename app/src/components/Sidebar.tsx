import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { Project, Document } from '../types';
import ProjectCreationModal from './ProjectCreationModal';

interface SidebarProps {
  selectedProject: Project | null;
  selectedDocument: Document | null;
  documents: Document[];
  onSelectProject: (project: Project) => void;
  onBack: () => void;
  onCreateDocument: (title: string) => void;
  onSelectDocument: (doc: Document) => void;
}

function Sidebar({
  selectedProject,
  selectedDocument,
  documents,
  onSelectProject,
  onBack,
  onCreateDocument,
  onSelectDocument,
}: SidebarProps) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [newDocumentTitle, setNewDocumentTitle] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);

  const loadProjects = useCallback(async () => {
    try {
      const response = await invoke<{ success: boolean; data: Project[]; error?: string }>('list_projects');
      if (response.success) {
        setProjects(response.data || []);
      } else {
        console.error('Failed to load projects:', response.error);
      }
    } catch (error) {
      console.error('Error loading projects:', error);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadProjects();
  }, [loadProjects]);

  const handleCreateDocument = () => {
    if (!newDocumentTitle.trim()) return;
    onCreateDocument(newDocumentTitle.trim());
    setNewDocumentTitle('');
  };

  const handleProjectCreated = (project: Project) => {
    setProjects([...projects, project]);
  };

  return (
    <div className="sidebar">
      <ProjectCreationModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onProjectCreated={handleProjectCreated}
      />
      {selectedProject ? (
        <>
          <div className="sidebar-header">
            <button className="back-button" onClick={onBack}>
              ← Back to Projects
            </button>
            <h3>{selectedProject.name}</h3>
            {selectedProject.description && (
              <p className="project-description">{selectedProject.description}</p>
            )}
          </div>
          <div className="document-create">
            <input
              type="text"
              placeholder="New chapter title"
              value={newDocumentTitle}
              onChange={(e) => setNewDocumentTitle(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreateDocument()}
            />
            <button onClick={handleCreateDocument}>Add Chapter</button>
          </div>
          <ul className="document-list">
            {documents.map((doc) => (
               <li 
                key={doc.id} 
                className={selectedDocument?.id === doc.id ? 'active' : ''}
                onClick={() => onSelectDocument(doc)}
              >
                {doc.title}
                <span className="doc-date">
                  {new Date(doc.updated_at).toLocaleDateString()}
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <>
          <h2>Projects</h2>
          <div className="project-create">
            <button className="new-project-button" onClick={() => setIsModalOpen(true)}>
              + New Project
            </button>
          </div>
          <ul className="project-list">
            {projects.map((project) => (
              <li key={project.id} onClick={() => onSelectProject(project)}>
                <div className="project-info">
                  <div className="project-name">{project.name}</div>
                  {project.description && (
                    <div className="project-description-small">{project.description}</div>
                  )}
                </div>
                <span className="project-date">
                  {new Date(project.created_at).toLocaleDateString()}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

export default Sidebar;