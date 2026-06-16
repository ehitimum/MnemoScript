import { useState, useRef, useEffect } from 'react';
import type { Project, Document, Folder, DocType } from '../types';
import {
  ChevronDown,
  ChevronRight,
  FolderOpen,
  Folder as FolderIcon,
  FolderPlus,
  Plus,
  FileText,
  BookOpen,
  Layers,
  Edit3,
  File,
  Search,
  X,
  Pencil,
  Trash2,
  CornerUpLeft,
} from 'lucide-react';

interface SidebarProps {
  selectedProject: Project;
  selectedDocument: Document | null;
  documents: Document[];
  folders: Folder[];
  onCreateDocument: (title: string, docType?: DocType, folderId?: string | null) => void;
  onSelectDocument: (doc: Document) => void;
  onCreateFolder: (name: string, parentId?: string | null) => void;
  onRenameFolder: (id: string, name: string) => void;
  onDeleteFolder: (id: string) => void;
  onMoveDocument: (docId: string, folderId: string | null) => void;
  onMoveFolder: (folderId: string, newParentId: string | null) => void;
}

type DragPayload = { kind: 'doc' | 'folder'; id: string };
type ContextTarget = { x: number; y: number; kind: 'doc' | 'folder'; id: string };

function Sidebar({
  selectedProject,
  selectedDocument,
  documents,
  folders,
  onCreateDocument,
  onSelectDocument,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  onMoveDocument,
  onMoveFolder,
}: SidebarProps) {
  const [newDocumentTitle, setNewDocumentTitle] = useState('');
  const [isAddingDoc, setIsAddingDoc] = useState(false);
  const [isFolderExpanded, setIsFolderExpanded] = useState(true);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [filterText, setFilterText] = useState('');
  const menuRef = useRef<HTMLDivElement>(null);

  // Directory tree UI state.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [creatingParent, setCreatingParent] = useState<string | null | undefined>(undefined);
  const [newFolderName, setNewFolderName] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [ctx, setCtx] = useState<ContextTarget | null>(null);
  const [dropTarget, setDropTarget] = useState<string | 'root' | null>(null);
  const [draggedItem, setDraggedItem] = useState<DragPayload | null>(null);

  const filteredDocuments = documents.filter(doc =>
    doc.title.toLowerCase().includes(filterText.toLowerCase()),
  );

  // Auto-close the add menu and context menu when clicking outside.
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsMenuOpen(false);
      }
      setCtx(null);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setCtx(null);
        setCreatingParent(undefined);
        setRenamingId(null);
      }
    };
    document.addEventListener('keydown', onEsc);
    return () => document.removeEventListener('keydown', onEsc);
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

  // Auto-numbered creation (e.g. "Chapter 3"), optionally inside a folder.
  const handleAutoCreate = (type: string, docType: DocType = 'text', folderId: string | null = null) => {
    const pattern = new RegExp(`^${type} (\\d+)$`);
    let maxNum = 0;
    documents.forEach(doc => {
      const match = doc.title.match(pattern);
      if (match) {
        const num = parseInt(match[1], 10);
        if (num > maxNum) maxNum = num;
      }
    });
    onCreateDocument(`${type} ${maxNum + 1}`, docType, folderId);
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

  // ── Tree helpers ──────────────────────────────────────────────
  const sortByOrder = <T extends { order: number }>(a: T, b: T) => a.order - b.order;
  const childFolders = (parentId: string | null) =>
    folders.filter(f => (f.parentId ?? null) === parentId).sort(sortByOrder);
  const childDocs = (parentId: string | null) =>
    documents.filter(d => (d.folderId ?? null) === parentId).sort(sortByOrder);

  const toggleCollapse = (id: string) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const expand = (id: string) =>
    setCollapsed(prev => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });

  const startCreateFolder = (parentId: string | null) => {
    if (parentId) expand(parentId);
    setCreatingParent(parentId);
    setNewFolderName('');
    setCtx(null);
  };

  const commitCreateFolder = () => {
    if (creatingParent === undefined) return;
    if (newFolderName.trim()) onCreateFolder(newFolderName.trim(), creatingParent);
    setCreatingParent(undefined);
    setNewFolderName('');
  };

  const commitRename = () => {
    if (renamingId) onRenameFolder(renamingId, renameValue);
    setRenamingId(null);
  };

  // Flatten the folder tree (depth-first) for the "Move to" destination list.
  const flattenedFolders = (parentId: string | null = null, depth = 0): { folder: Folder; depth: number }[] =>
    childFolders(parentId).flatMap(f => [{ folder: f, depth }, ...flattenedChildren(f.id, depth + 1)]);
  const flattenedChildren = (parentId: string, depth: number) => flattenedFolders(parentId, depth);

  const isDescendant = (folderId: string, ancestorId: string): boolean => {
    let cur: string | null | undefined = folders.find(f => f.id === folderId)?.parentId ?? null;
    while (cur) {
      if (cur === ancestorId) return true;
      cur = folders.find(f => f.id === cur)?.parentId ?? null;
    }
    return false;
  };

  // ── Drag & drop ───────────────────────────────────────────────
  const onDragStartItem = (payload: DragPayload) => (e: React.DragEvent) => {
    setDraggedItem(payload);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', payload.id);
  };

  const canDropOn = (item: DragPayload | null, targetFolderId: string | null): boolean => {
    if (!item) return false;
    if (item.kind === 'folder') {
      if (item.id === targetFolderId) return false;
      if (targetFolderId && isDescendant(targetFolderId, item.id)) return false;
    }
    return true;
  };

  const onDropOn = (targetFolderId: string | null) => (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const item = draggedItem;
    setDropTarget(null);
    setDraggedItem(null);
    if (!item || !canDropOn(item, targetFolderId)) return;
    if (item.kind === 'doc') onMoveDocument(item.id, targetFolderId);
    else onMoveFolder(item.id, targetFolderId);
  };

  const onDragOverTarget = (key: string | 'root', targetFolderId: string | null) => (e: React.DragEvent) => {
    if (!canDropOn(draggedItem, targetFolderId)) return;
    e.preventDefault();
    e.stopPropagation();
    setDropTarget(key);
  };

  // ── Renderers ─────────────────────────────────────────────────
  const renderTree = (parentId: string | null, depth: number) => {
    const subFolders = childFolders(parentId);
    const docs = childDocs(parentId);
    return (
      <>
        {creatingParent === parentId && (
          <div className="flex items-center gap-1.5 px-2 py-1" style={{ paddingLeft: depth * 12 + 8 }}>
            <FolderIcon className="w-3.5 h-3.5 text-amber-500/80 flex-shrink-0" />
            <input
              autoFocus
              className="flex-1 min-w-0 bg-secondary/40 border border-primary/50 text-foreground text-xs rounded px-2 py-1 outline-none"
              placeholder="Directory name…"
              value={newFolderName}
              onChange={e => setNewFolderName(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') commitCreateFolder();
                if (e.key === 'Escape') setCreatingParent(undefined);
              }}
              onBlur={commitCreateFolder}
            />
          </div>
        )}

        {subFolders.map(folder => {
          const isCollapsed = collapsed.has(folder.id);
          const isDrop = dropTarget === folder.id;
          return (
            <div key={folder.id}>
              <div
                draggable={renamingId !== folder.id}
                onDragStart={onDragStartItem({ kind: 'folder', id: folder.id })}
                onDragOver={onDragOverTarget(folder.id, folder.id)}
                onDragLeave={() => setDropTarget(prev => (prev === folder.id ? null : prev))}
                onDrop={onDropOn(folder.id)}
                onClick={() => toggleCollapse(folder.id)}
                onContextMenu={e => {
                  e.preventDefault();
                  e.stopPropagation();
                  setCtx({ x: e.clientX, y: e.clientY, kind: 'folder', id: folder.id });
                }}
                className={`flex items-center gap-1.5 pr-2 py-1.5 rounded-md cursor-pointer transition-all duration-150 group ${
                  isDrop ? 'bg-primary/15 ring-1 ring-primary/40' : 'hover:bg-secondary/40'
                }`}
                style={{ paddingLeft: depth * 12 + 6 }}
              >
                <span className="text-muted-foreground/60 group-hover:text-foreground flex-shrink-0">
                  {isCollapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                </span>
                {isCollapsed ? (
                  <FolderIcon className="w-4 h-4 text-amber-500/80 flex-shrink-0" />
                ) : (
                  <FolderOpen className="w-4 h-4 text-amber-500/80 flex-shrink-0" />
                )}
                {renamingId === folder.id ? (
                  <input
                    autoFocus
                    className="flex-1 min-w-0 bg-secondary/40 border border-primary/50 text-foreground text-xs rounded px-1.5 py-0.5 outline-none"
                    value={renameValue}
                    onClick={e => e.stopPropagation()}
                    onChange={e => setRenameValue(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') commitRename();
                      if (e.key === 'Escape') setRenamingId(null);
                    }}
                    onBlur={commitRename}
                  />
                ) : (
                  <span className="text-xs font-semibold text-foreground/85 truncate flex-1" title={folder.name}>
                    {folder.name}
                  </span>
                )}
              </div>
              {!isCollapsed && renderTree(folder.id, depth + 1)}
            </div>
          );
        })}

        {docs.map(doc => (
          <div
            key={doc.id}
            draggable
            onDragStart={onDragStartItem({ kind: 'doc', id: doc.id })}
            onClick={() => onSelectDocument(doc)}
            onContextMenu={e => {
              e.preventDefault();
              e.stopPropagation();
              setCtx({ x: e.clientX, y: e.clientY, kind: 'doc', id: doc.id });
            }}
            className={`flex items-center gap-2.5 pr-3 py-2 rounded-md cursor-pointer transition-all duration-150 text-xs font-medium border-l-2 ${
              selectedDocument?.id === doc.id
                ? 'bg-primary/10 text-primary border-primary'
                : 'text-foreground/80 hover:bg-secondary/35 hover:text-foreground border-transparent'
            }`}
            style={{ paddingLeft: depth * 12 + 12 }}
          >
            {getIconForDoc(doc.title)}
            <span className="truncate flex-1" title={doc.title}>
              {doc.title}
            </span>
          </div>
        ))}
      </>
    );
  };

  // Destinations for the "Move to" context-menu section.
  const moveDestinations = (excludeFolderId?: string) => {
    const list = flattenedFolders().filter(({ folder }) => {
      if (!excludeFolderId) return true;
      return folder.id !== excludeFolderId && !isDescendant(folder.id, excludeFolderId);
    });
    return list;
  };

  const doMove = (destId: string | null) => {
    if (!ctx) return;
    if (ctx.kind === 'doc') onMoveDocument(ctx.id, destId);
    else onMoveFolder(ctx.id, destId);
    setCtx(null);
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
            title="Add…"
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
                onClick={() => handleAutoCreate('MindMap', 'mindmap')}
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
                  setIsMenuOpen(false);
                  startCreateFolder(null);
                }}
              >
                <FolderPlus className="w-3.5 h-3.5" />
                <span>New Directory</span>
              </button>
              <button
                className="w-full text-left bg-transparent border-none text-xs text-foreground/90 hover:bg-primary hover:text-primary-foreground px-2.5 py-1.5 rounded-md cursor-pointer transition-all flex items-center gap-2"
                onClick={() => {
                  setIsAddingDoc(true);
                  setIsMenuOpen(false);
                  setNewDocumentTitle('');
                }}
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Custom…</span>
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

      {/* Project / Documents Directory Tree */}
      <div className="flex-1 overflow-y-auto py-2 px-2 scrollbar-thin">
        {/* Project Header Row — also the "move to root" drop target */}
        <div
          className={`flex items-center gap-2 px-2.5 py-1.5 rounded-md cursor-pointer transition-all duration-150 group ${
            dropTarget === 'root' ? 'bg-primary/15 ring-1 ring-primary/40' : 'hover:bg-secondary/40'
          }`}
          onClick={() => setIsFolderExpanded(!isFolderExpanded)}
          onDragOver={onDragOverTarget('root', null)}
          onDragLeave={() => setDropTarget(prev => (prev === 'root' ? null : prev))}
          onDrop={onDropOn(null)}
        >
          <span className={`text-muted-foreground/60 group-hover:text-foreground transition-transform duration-200 ${isFolderExpanded ? 'rotate-0' : '-rotate-90'}`}>
            <ChevronDown className="w-3.5 h-3.5" />
          </span>
          <FolderOpen className="w-4 h-4 text-amber-500/80 group-hover:text-amber-500 transition-colors flex-shrink-0" />
          <span className="text-xs font-semibold text-foreground/90 truncate uppercase tracking-wider" title={selectedProject.name}>
            {selectedProject.name}
          </span>
        </div>

        {/* Body: flat filtered list while searching, otherwise the nested tree */}
        {isFolderExpanded && (
          <div
            className="mt-1 flex flex-col gap-0.5 min-h-[40px]"
            onDragOver={onDragOverTarget('root', null)}
            onDrop={onDropOn(null)}
          >
            {filterText ? (
              filteredDocuments.length === 0 ? (
                <div className="text-xs text-muted-foreground/60 italic px-3 py-2 pl-6">No matching items</div>
              ) : (
                filteredDocuments.map(doc => (
                  <div
                    key={doc.id}
                    onClick={() => onSelectDocument(doc)}
                    className={`flex items-center gap-2.5 px-3 py-2 pl-6 rounded-md cursor-pointer transition-all duration-150 text-xs font-medium border-l-2 ${
                      selectedDocument?.id === doc.id
                        ? 'bg-primary/10 text-primary border-primary'
                        : 'text-foreground/80 hover:bg-secondary/35 hover:text-foreground border-transparent'
                    }`}
                  >
                    {getIconForDoc(doc.title)}
                    <span className="truncate flex-1" title={doc.title}>{doc.title}</span>
                  </div>
                ))
              )
            ) : folders.length === 0 && documents.length === 0 && creatingParent === undefined ? (
              <div className="text-xs text-muted-foreground/60 italic px-3 py-2 pl-6">Empty workspace</div>
            ) : (
              renderTree(null, 0)
            )}
          </div>
        )}
      </div>

      {/* Right-click Context Menu */}
      {ctx && (
        <div
          className="fixed z-1100 min-w-[180px] bg-popover text-popover-foreground border border-border/40 shadow-2xl rounded-lg p-1.5 flex flex-col gap-0.5 animate-in fade-in zoom-in-95 duration-100 backdrop-blur-lg"
          style={{ top: ctx.y, left: ctx.x }}
          onMouseDown={e => e.stopPropagation()}
          onContextMenu={e => e.preventDefault()}
        >
          {ctx.kind === 'folder' && (
            <>
              <button
                className="w-full text-left text-xs hover:bg-primary hover:text-primary-foreground px-2.5 py-1.5 rounded-md cursor-pointer flex items-center gap-2"
                onClick={() => startCreateFolder(ctx.id)}
              >
                <FolderPlus className="w-3.5 h-3.5" /> New Subfolder
              </button>
              <button
                className="w-full text-left text-xs hover:bg-primary hover:text-primary-foreground px-2.5 py-1.5 rounded-md cursor-pointer flex items-center gap-2"
                onClick={() => { handleAutoCreate('Chapter', 'text', ctx.id); setCtx(null); }}
              >
                <BookOpen className="w-3.5 h-3.5" /> New Chapter here
              </button>
              <button
                className="w-full text-left text-xs hover:bg-primary hover:text-primary-foreground px-2.5 py-1.5 rounded-md cursor-pointer flex items-center gap-2"
                onClick={() => {
                  const f = folders.find(x => x.id === ctx.id);
                  setRenamingId(ctx.id);
                  setRenameValue(f?.name ?? '');
                  setCtx(null);
                }}
              >
                <Pencil className="w-3.5 h-3.5" /> Rename
              </button>
              <button
                className="w-full text-left text-xs hover:bg-destructive hover:text-white px-2.5 py-1.5 rounded-md cursor-pointer flex items-center gap-2"
                onClick={() => { onDeleteFolder(ctx.id); setCtx(null); }}
              >
                <Trash2 className="w-3.5 h-3.5" /> Delete Directory
              </button>
              <div className="h-px bg-border/40 my-1" />
            </>
          )}

          <div className="px-2.5 py-1 text-3xs uppercase tracking-wider text-muted-foreground/60 flex items-center gap-1.5">
            <CornerUpLeft className="w-3 h-3" /> Move to
          </div>
          <div className="max-h-52 overflow-y-auto flex flex-col gap-0.5">
            <button
              className="w-full text-left text-xs hover:bg-primary hover:text-primary-foreground px-2.5 py-1.5 rounded-md cursor-pointer flex items-center gap-2"
              onClick={() => doMove(null)}
            >
              <FolderOpen className="w-3.5 h-3.5 text-amber-500/80" /> {selectedProject.name} (root)
            </button>
            {moveDestinations(ctx.kind === 'folder' ? ctx.id : undefined).map(({ folder, depth }) => (
              <button
                key={folder.id}
                className="w-full text-left text-xs hover:bg-primary hover:text-primary-foreground px-2.5 py-1.5 rounded-md cursor-pointer flex items-center gap-2"
                style={{ paddingLeft: depth * 12 + 10 }}
                onClick={() => doMove(folder.id)}
              >
                <FolderIcon className="w-3.5 h-3.5 text-amber-500/80 flex-shrink-0" />
                <span className="truncate">{folder.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </aside>
  );
}

export default Sidebar;
