import { useState, useRef, useEffect } from 'react';
import type { Project, Document } from '../types';
import { ChevronDown, FolderOpen, Plus, FileText, BookOpen, Layers, Edit3, File, Search, X } from 'lucide-react';

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

  const getIconForDoc = (title: string) => {
    const t = title.toLowerCase();
    if (t.includes('chapter')) return <BookOpen className="w-3.5 h-3.5 text-amber-500/80" />;
    if (t.includes('note')) return <Edit3 className="w-3.5 h-3.5 text-emerald-500/80" />;
    if (t.includes('mindmap')) return <Layers className="w-3.5 h-3.5 text-purple-500/80" />;
    if (t.includes('scene')) return <FileText className="w-3.5 h-3.5 text-sky-500/80" />;
    return <File className="w-3.5 h-3.5 text-muted-foreground/80" />;
  };

  return (
    <aside className="w-64 bg-sidebar border-r border-border/40 flex flex-col select-none transition-all duration-200">
      {/* Sidebar Header */}
      <div className="h-10 flex items-center justify-between px-4 border-b border-border/30">
        <span className="text-2xs font-semibold tracking-wider text-muted-foreground uppercase">
          Explorer
        </span>
        <div className="relative" ref={menuRef}>
          <button
            className={`w-6 h-6 flex items-center justify-center rounded-md text-foreground/80 hover:bg-secondary/60 active:scale-95 cursor-pointer transition-all ${
              isMenuOpen ? 'bg-secondary text-primary' : ''
            }`}
            onClick={() => setIsMenuOpen(!isMenuOpen)}
            title="Add Document..."
          >
            <Plus className="w-4 h-4" />
          </button>
          
          {isMenuOpen && (
            <div className="absolute right-0 mt-1.5 w-44 bg-popover text-popover-foreground border border-border/40 shadow-xl rounded-lg p-1.5 z-1050 flex flex-col gap-0.5 animate-in fade-in slide-in-from-top-1 duration-150 backdrop-blur-lg">
              <button 
                className="w-full text-left bg-transparent border-none text-xs text-foreground/90 hover:bg-primary hover:text-primary-foreground px-2.5 py-1.5 rounded-md cursor-pointer transition-all flex items-center gap-2" 
                onClick={() => handleAutoCreate('Note')}
              >
                <Edit3 className="w-3.5 h-3.5" />
                <span>New Note</span>
              </button>
              <button 
                className="w-full text-left bg-transparent border-none text-xs text-foreground/90 hover:bg-primary hover:text-primary-foreground px-2.5 py-1.5 rounded-md cursor-pointer transition-all flex items-center gap-2" 
                onClick={() => handleAutoCreate('Chapter')}
              >
                <BookOpen className="w-3.5 h-3.5" />
                <span>New Chapter</span>
              </button>
              <button 
                className="w-full text-left bg-transparent border-none text-xs text-foreground/90 hover:bg-primary hover:text-primary-foreground px-2.5 py-1.5 rounded-md cursor-pointer transition-all flex items-center gap-2" 
                onClick={() => handleAutoCreate('MindMap')}
              >
                <Layers className="w-3.5 h-3.5" />
                <span>New MindMap</span>
              </button>
              <button 
                className="w-full text-left bg-transparent border-none text-xs text-foreground/90 hover:bg-primary hover:text-primary-foreground px-2.5 py-1.5 rounded-md cursor-pointer transition-all flex items-center gap-2" 
                onClick={() => handleAutoCreate('Scene')}
              >
                <FileText className="w-3.5 h-3.5" />
                <span>New Scene</span>
              </button>
              <div className="h-px bg-border/40 my-1" />
              <button 
                className="w-full text-left bg-transparent border-none text-xs text-foreground/90 hover:bg-primary hover:text-primary-foreground px-2.5 py-1.5 rounded-md cursor-pointer transition-all flex items-center gap-2 font-medium" 
                onClick={() => { 
                  setIsAddingDoc(true); 
                  setIsMenuOpen(false); 
                  setNewDocumentTitle('');
                }}
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Custom...</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Inline Document Creation */}
      {isAddingDoc && (
        <div className="flex items-center gap-2 px-3 py-2 bg-background/50 border-b border-border/20">
          <File className="w-3.5 h-3.5 text-primary/70 animate-pulse" />
          <input
            className="flex-1 min-w-0 bg-secondary/40 border border-primary/50 text-foreground text-xs rounded px-2 py-1 outline-none placeholder:text-muted-foreground/60"
            type="text"
            autoFocus
            placeholder="document-title.md"
            value={newDocumentTitle}
            onChange={(e) => setNewDocumentTitle(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={handleCreateDocument}
          />
        </div>
      )}

      {/* Search Filter Box */}
      <div className="relative flex items-center px-3 py-2 border-b border-border/20">
        <Search className="w-3.5 h-3.5 text-muted-foreground/50 absolute left-5.5 pointer-events-none" />
        <input
          className="w-full bg-secondary/35 border border-border/25 text-foreground rounded px-2.5 py-1.5 pl-7 text-xs outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 placeholder:text-muted-foreground/60 transition-all"
          type="text"
          placeholder="Filter workspace items..."
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
        />
        {filterText && (
          <button 
            className="absolute right-5 bg-transparent border-none text-muted-foreground/60 hover:text-foreground cursor-pointer text-xs flex items-center justify-center p-0.5 rounded-full hover:bg-secondary" 
            onClick={() => setFilterText('')}
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </div>

      {/* Project/Documents Directory Tree */}
      <div className="flex-1 overflow-y-auto py-2 px-2 scrollbar-thin">
        <div>
          {/* Project Header Row */}
          <div 
            className="flex items-center gap-2 px-2.5 py-1.5 hover:bg-secondary/40 rounded-md cursor-pointer transition-all duration-150 group"
            onClick={() => setIsFolderExpanded(!isFolderExpanded)}
          >
            <span className={`text-muted-foreground/60 group-hover:text-foreground transition-transform duration-200 ${isFolderExpanded ? 'rotate-0' : '-rotate-90'}`}>
              <ChevronDown className="w-3.5 h-3.5" />
            </span>
            <FolderOpen className="w-4 h-4 text-amber-500/80 group-hover:text-amber-500 transition-colors flex-shrink-0" />
            <span className="text-xs font-semibold text-foreground/90 truncate uppercase tracking-wider" title={selectedProject.name}>
              {selectedProject.name}
            </span>
          </div>

          {/* Child Documents List */}
          {isFolderExpanded && (
            <ul className="list-none mt-1 pl-4 flex flex-col gap-0.5">
              {filteredDocuments.length === 0 ? (
                <li className="text-xs text-muted-foreground/60 italic px-3 py-2 pl-6">
                  {filterText ? 'No matching items' : 'Empty workspace'}
                </li>
              ) : (
                filteredDocuments.map((doc) => (
                  <li
                    key={doc.id}
                    className={`flex items-center gap-2.5 px-3 py-2 rounded-md cursor-pointer transition-all duration-150 text-xs font-medium border-l-2 ${
                      selectedDocument?.id === doc.id 
                        ? 'bg-primary/10 text-primary border-primary' 
                        : 'text-foreground/80 hover:bg-secondary/35 hover:text-foreground border-transparent'
                    }`}
                    onClick={() => onSelectDocument(doc)}
                  >
                    {getIconForDoc(doc.title)}
                    <span className="truncate flex-1" title={doc.title}>
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