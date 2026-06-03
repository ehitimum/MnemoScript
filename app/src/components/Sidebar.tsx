import { useState } from 'react';
import type { Project, Document } from '../types';

interface SidebarProps {
  selectedProject: Project;
  selectedDocument: Document | null;
  documents: Document[];
  onCreateDocument: (title: string) => void;
  onSelectDocument: (doc: Document) => void;
}

function Sidebar({
  selectedProject,
  selectedDocument,
  documents,
  onCreateDocument,
  onSelectDocument,
}: SidebarProps) {
  const [newDocumentTitle, setNewDocumentTitle] = useState('');
  const [isAddingDoc, setIsAddingDoc] = useState(false);
  const [isFolderExpanded, setIsFolderExpanded] = useState(true);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleCreateDocument();
    } else if (e.key === 'Escape') {
      setIsAddingDoc(false);
      setNewDocumentTitle('');
    }
  };

  const handleCreateDocument = () => {
    if (!newDocumentTitle.trim()) {
      setIsAddingDoc(false);
      return;
    }
    onCreateDocument(newDocumentTitle.trim());
    setNewDocumentTitle('');
    setIsAddingDoc(false);
  };

  return (
    <aside className="workspace-sidebar">
      <div className="sidebar-explorer-header">
        <span className="explorer-header-title">EXPLORER</span>
        <button
          className="add-doc-icon-btn"
          onClick={() => setIsAddingDoc(!isAddingDoc)}
          title="Create New Chapter (Press Enter)"
        >
          ＋
        </button>
      </div>

      {isAddingDoc && (
        <div className="sidebar-inline-create">
          <span className="inline-icon">📄</span>
          <input
            className="inline-create-input"
            type="text"
            autoFocus
            placeholder="chapter-name.md"
            value={newDocumentTitle}
            onChange={(e) => setNewDocumentTitle(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={handleCreateDocument}
          />
        </div>
      )}

      <div className="sidebar-tree-container">
        <div className="tree-project-node">
          <div 
            className="project-folder-row"
            onClick={() => setIsFolderExpanded(!isFolderExpanded)}
          >
            <span className={`folder-chevron ${isFolderExpanded ? 'expanded' : ''}`}>
              ▶
            </span>
            <span className="project-name-text" title={selectedProject.name}>
              {selectedProject.name.toUpperCase()}
            </span>
          </div>

          {isFolderExpanded && (
            <ul className="project-document-list">
              {documents.length === 0 ? (
                <li className="document-item-empty">
                  Empty workspace workspace.
                </li>
              ) : (
                documents.map((doc) => (
                  <li
                    key={doc.id}
                    className={`document-item-row ${selectedDocument?.id === doc.id ? 'active' : ''}`}
                    onClick={() => onSelectDocument(doc)}
                  >
                    <span className="document-icon">📄</span>
                    <span className="document-title-text" title={doc.title}>
                      {doc.title}
                    </span>
                  </li>
                ))
              )}
            </ul>
          )}
        </div>
      </div>
    </aside>
  );
}

export default Sidebar;