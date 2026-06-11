import { useState, useRef, useEffect } from 'react';
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
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [filterText, setFilterText] = useState('');
  const menuRef = useRef<HTMLDivElement>(null);

  const filteredDocuments = documents.filter(doc => 
    doc.title.toLowerCase().includes(filterText.toLowerCase())
  );

  // Auto-close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

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

  const handleAutoCreate = (type: string) => {
    // Scans titles like "Chapter 1", "Note 2" etc.
    const pattern = new RegExp(`^${type} (\\d+)$`);
    let maxNum = 0;

    documents.forEach(doc => {
      const match = doc.title.match(pattern);
      if (match) {
        const num = parseInt(match[1], 10);
        if (num > maxNum) maxNum = num;
      }
    });

    onCreateDocument(`${type} ${maxNum + 1}`);
    setIsMenuOpen(false);
  };

  return (
    <aside className="workspace-sidebar">
      <div className="sidebar-explorer-header">
        <span className="explorer-header-title">EXPLORER</span>
        <div className="add-doc-menu-container" ref={menuRef} style={{ position: 'relative' }}>
          <button
            className={`add-doc-icon-btn ${isMenuOpen ? 'active' : ''}`}
            onClick={() => setIsMenuOpen(!isMenuOpen)}
            title="Add Document..."
          >
            ＋
          </button>
          
          {isMenuOpen && (
            <div className="add-doc-dropdown-menu">
              <button className="menu-item-btn" onClick={() => handleAutoCreate('Note')}>
                <span className="menu-icon">📝</span>
                <span>Note</span>
              </button>
              <button className="menu-item-btn" onClick={() => handleAutoCreate('Chapter')}>
                <span className="menu-icon">📖</span>
                <span>Chapter</span>
              </button>
              <button className="menu-item-btn" onClick={() => handleAutoCreate('MindMap')}>
                <span className="menu-icon">🧠</span>
                <span>MindMap</span>
              </button>
              <button className="menu-item-btn" onClick={() => handleAutoCreate('Scene')}>
                <span className="menu-icon">🎬</span>
                <span>Scene</span>
              </button>
              <div className="menu-separator" />
              <button 
                className="menu-item-btn" 
                onClick={() => { 
                  setIsAddingDoc(true); 
                  setIsMenuOpen(false); 
                  setNewDocumentTitle('');
                }}
              >
                <span className="menu-icon">➕</span>
                <span>Custom...</span>
              </button>
            </div>
          )}
        </div>
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

      <div className="sidebar-filter-container">
        <input
          className="sidebar-filter-input"
          type="text"
          placeholder="Filter items..."
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
        />
        {filterText && (
          <button className="clear-filter-btn" onClick={() => setFilterText('')}>✕</button>
        )}
      </div>

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
              {filteredDocuments.length === 0 ? (
                <li className="document-item-empty">
                  {filterText ? 'No matching items.' : 'Empty workspace.'}
                </li>
              ) : (
                filteredDocuments.map((doc) => (
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