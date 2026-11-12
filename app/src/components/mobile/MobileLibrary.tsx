import { useMemo, useState } from 'react';
import type { Project, Document, Folder, DocType } from '../../types';
import {
  Plus,
  Search,
  FileText,
  BookOpen,
  ScrollText,
  Network,
  Map as MapIcon,
  MoreVertical,
  Trash2,
  FolderOpen,
  FolderPlus,
  FilePlus2,
  Copy,
  FolderInput,
  ChevronRight,
  ArrowLeft,
  Check,
} from 'lucide-react';
import BottomSheet from './BottomSheet';

interface Props {
  selectedProject: Project | null;
  projects: Project[];
  documents: Document[];
  folders: Folder[];
  onOpenProject: (p: Project) => void;
  onCloseProject: () => void;
  onNewProject: () => void;
  onSelectDocument: (doc: Document) => void;
  onCreateDocument: (title: string, docType?: DocType, folderId?: string | null) => void;
  onCreateFolder: (name: string, parentId?: string | null) => void;
  onRenameDocument: (id: string, title: string) => void;
  onDeleteDocuments: (ids: string[]) => void;
  onDuplicateDocuments: (ids: string[], folderId?: string | null) => void;
  onMoveDocuments: (ids: string[], folderId: string | null) => void;
}

const DOC_KINDS: { label: string; type: DocType; icon: typeof FileText; desc: string }[] = [
  { label: 'Note', type: 'text', icon: FileText, desc: 'A quick idea or reference' },
  { label: 'Chapter', type: 'text', icon: BookOpen, desc: 'A section of your story' },
  { label: 'Scene', type: 'text', icon: ScrollText, desc: 'A single moment or beat' },
  { label: 'Mind Map', type: 'mindmap', icon: Network, desc: 'Visual idea web' },
  { label: 'Fantasy Map', type: 'fantasymap', icon: MapIcon, desc: 'Draw a world map' },
];

function docIcon(doc: Document) {
  if (doc.docType === 'mindmap') return Network;
  if (doc.docType === 'fantasymap') return MapIcon;
  const t = doc.title.toLowerCase();
  if (t.startsWith('chapter')) return BookOpen;
  if (t.startsWith('scene')) return ScrollText;
  return FileText;
}

/** Mobile "Library": projects when none is open, else a clean grouped document
 *  list with search, a new-document sheet, and per-document actions. */
function MobileLibrary({
  selectedProject,
  projects,
  documents,
  folders,
  onOpenProject,
  onCloseProject,
  onNewProject,
  onSelectDocument,
  onCreateDocument,
  onCreateFolder,
  onRenameDocument,
  onDeleteDocuments,
  onDuplicateDocuments,
  onMoveDocuments,
}: Props) {
  const [query, setQuery] = useState('');
  const [newOpen, setNewOpen] = useState(false);
  const [actionDoc, setActionDoc] = useState<Document | null>(null);
  const [renameValue, setRenameValue] = useState('');
  // Name-input sheet for creating a Folder or a Custom (free-named) document.
  const [nameSheet, setNameSheet] = useState<{ kind: 'folder' | 'custom'; value: string } | null>(null);
  // Folder-picker sheet for "Move to…".
  const [moveDoc, setMoveDoc] = useState<Document | null>(null);

  const filtered = useMemo(
    () => documents.filter((d) => d.title.toLowerCase().includes(query.trim().toLowerCase())),
    [documents, query],
  );

  // Group filtered docs: root (no folder) first, then one section per folder.
  const groups = useMemo(() => {
    const root = filtered.filter((d) => !d.folderId);
    const byFolder = folders
      .map((f) => ({ folder: f, docs: filtered.filter((d) => d.folderId === f.id) }))
      .filter((g) => g.docs.length > 0);
    return { root, byFolder };
  }, [filtered, folders]);

  const nextTitle = (label: string) => {
    const n = documents.filter((d) => d.title.toLowerCase().startsWith(label.toLowerCase())).length + 1;
    return `${label} ${n}`;
  };

  // ── Projects view (no project open) ──────────────────────────────────────
  if (!selectedProject) {
    return (
      <div className="flex-1 overflow-y-auto px-4 py-5 flex flex-col gap-5">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Your Projects</h1>
          <p className="text-sm text-muted-foreground">Open a project or start a new one.</p>
        </div>

        <button className="mn-btn mn-btn-primary w-full" onClick={onNewProject}>
          <Plus className="w-5 h-5" /> New Project
        </button>

        <div className="flex flex-col gap-2.5">
          {projects.length === 0 && (
            <p className="text-sm text-muted-foreground/70 text-center py-10">
              No projects yet. Tap “New Project” to begin.
            </p>
          )}
          {projects.map((p) => (
            <button key={p.id} className="mn-row" onClick={() => onOpenProject(p)}>
              <div className="w-10 h-10 rounded-xl bg-primary/12 flex items-center justify-center text-primary shrink-0">
                <FolderOpen className="w-5 h-5" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{p.name}</div>
                <div className="text-3xs text-muted-foreground/70 truncate">{p.path}</div>
              </div>
              <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
            </button>
          ))}
        </div>
      </div>
    );
  }

  // ── Documents view (project open) ────────────────────────────────────────
  return (
    <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-4 relative">
      <div className="flex items-center gap-2">
        <button
          className="w-9 h-9 flex items-center justify-center rounded-xl bg-secondary/40 text-foreground/80 active:scale-90"
          onClick={onCloseProject}
          title="All projects"
        >
          <ArrowLeft className="w-4.5 h-4.5" />
        </button>
        <div className="flex-1 min-w-0">
          <div className="text-lg font-semibold truncate">{selectedProject.name}</div>
          <div className="text-3xs text-muted-foreground/70">
            {documents.length} document{documents.length === 1 ? '' : 's'}
          </div>
        </div>
      </div>

      {/* Search */}
      <div className="flex items-center gap-2 px-3 h-11 rounded-xl bg-secondary/35 border border-border/40">
        <Search className="w-4 h-4 text-muted-foreground shrink-0" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search documents"
          className="flex-1 bg-transparent outline-none text-sm placeholder:text-muted-foreground/60"
        />
      </div>

      {/* Doc list */}
      <div className="flex flex-col gap-4 pb-24">
        {documents.length === 0 && (
          <p className="text-sm text-muted-foreground/70 text-center py-10">
            No documents yet. Tap the + button to create one.
          </p>
        )}

        {groups.root.length > 0 && (
          <DocSection docs={groups.root} onSelect={onSelectDocument} onAction={(d) => { setActionDoc(d); setRenameValue(d.title); }} />
        )}
        {groups.byFolder.map(({ folder, docs }) => (
          <div key={folder.id} className="flex flex-col gap-2">
            <div className="flex items-center gap-2 px-1 text-3xs font-semibold tracking-[0.1em] uppercase text-muted-foreground/70">
              <FolderOpen className="w-3.5 h-3.5" /> {folder.name}
            </div>
            <DocSection docs={docs} onSelect={onSelectDocument} onAction={(d) => { setActionDoc(d); setRenameValue(d.title); }} />
          </div>
        ))}
      </div>

      {/* New-document FAB */}
      <button className="mn-fab" style={{ bottom: 18 }} onClick={() => setNewOpen(true)} title="New document">
        <Plus className="w-6 h-6" />
      </button>

      {/* New-document picker */}
      {newOpen && (
      <BottomSheet onClose={() => setNewOpen(false)} title="Create new">
        <div className="flex flex-col gap-2">
          {DOC_KINDS.map((k) => (
            <button
              key={k.label}
              className="mn-row"
              onClick={() => {
                onCreateDocument(nextTitle(k.label), k.type, null);
                setNewOpen(false);
              }}
            >
              <div className="w-10 h-10 rounded-xl bg-primary/12 flex items-center justify-center text-primary shrink-0">
                <k.icon className="w-5 h-5" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium">{k.label}</div>
                <div className="text-3xs text-muted-foreground/70">{k.desc}</div>
              </div>
            </button>
          ))}

          <div className="h-px bg-border/40 my-1" />

          <button className="mn-row" onClick={() => { setNewOpen(false); setNameSheet({ kind: 'custom', value: '' }); }}>
            <div className="w-10 h-10 rounded-xl bg-primary/12 flex items-center justify-center text-primary shrink-0">
              <FilePlus2 className="w-5 h-5" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium">Custom Document</div>
              <div className="text-3xs text-muted-foreground/70">Choose your own name</div>
            </div>
          </button>

          <button className="mn-row" onClick={() => { setNewOpen(false); setNameSheet({ kind: 'folder', value: '' }); }}>
            <div className="w-10 h-10 rounded-xl bg-primary/12 flex items-center justify-center text-primary shrink-0">
              <FolderPlus className="w-5 h-5" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium">New Folder</div>
              <div className="text-3xs text-muted-foreground/70">Group documents together</div>
            </div>
          </button>
        </div>
      </BottomSheet>
      )}

      {/* Per-document actions */}
      {actionDoc && (
      <BottomSheet onClose={() => setActionDoc(null)} title="Document">
        {actionDoc && (
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-2 px-3 h-12 rounded-xl bg-secondary/35 border border-border/40">
              <input
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                className="flex-1 bg-transparent outline-none text-sm"
              />
              <button
                className="text-primary p-1 active:scale-90"
                onClick={() => {
                  onRenameDocument(actionDoc.id, renameValue);
                  setActionDoc(null);
                }}
                title="Save name"
              >
                <Check className="w-5 h-5" />
              </button>
            </div>

            <button
              className="mn-btn mn-btn-ghost w-full"
              onClick={() => {
                onDuplicateDocuments([actionDoc.id]);
                setActionDoc(null);
              }}
            >
              <Copy className="w-5 h-5" /> Duplicate
            </button>

            <button
              className="mn-btn mn-btn-ghost w-full"
              onClick={() => {
                setMoveDoc(actionDoc);
                setActionDoc(null);
              }}
            >
              <FolderInput className="w-5 h-5" /> Move to…
            </button>

            <button
              className="mn-btn mn-btn-ghost w-full text-red-400"
              onClick={() => {
                onDeleteDocuments([actionDoc.id]);
                setActionDoc(null);
              }}
            >
              <Trash2 className="w-5 h-5" /> Delete document
            </button>
          </div>
        )}
      </BottomSheet>
      )}

      {/* Name input — Folder or Custom document */}
      {nameSheet && (
        <BottomSheet
          onClose={() => setNameSheet(null)}
          title={nameSheet.kind === 'folder' ? 'New Folder' : 'New Document'}
        >
          <div className="flex flex-col gap-3">
            <input
              autoFocus
              value={nameSheet.value}
              onChange={(e) => setNameSheet({ ...nameSheet, value: e.target.value })}
              placeholder={nameSheet.kind === 'folder' ? 'Folder name' : 'Document name'}
              className="px-3 h-12 rounded-xl bg-secondary/35 border border-border/40 outline-none text-sm placeholder:text-muted-foreground/60"
            />
            <button
              className={`mn-btn mn-btn-primary w-full ${!nameSheet.value.trim() ? 'opacity-50' : ''}`}
              disabled={!nameSheet.value.trim()}
              onClick={() => {
                const name = nameSheet.value.trim();
                if (!name) return;
                if (nameSheet.kind === 'folder') onCreateFolder(name, null);
                else onCreateDocument(name, 'text', null);
                setNameSheet(null);
              }}
            >
              <Check className="w-5 h-5" /> Create
            </button>
          </div>
        </BottomSheet>
      )}

      {/* Move to — folder picker (root + folders) */}
      {moveDoc && (
        <BottomSheet onClose={() => setMoveDoc(null)} title="Move to">
          <div className="flex flex-col gap-2">
            <button
              className="mn-row"
              onClick={() => { onMoveDocuments([moveDoc.id], null); setMoveDoc(null); }}
            >
              <div className="w-9 h-9 rounded-lg bg-secondary/50 flex items-center justify-center text-primary/90 shrink-0">
                <FolderOpen className="w-4.5 h-4.5" />
              </div>
              <div className="flex-1 min-w-0 text-sm font-medium truncate">{selectedProject.name} (root)</div>
              {(moveDoc.folderId ?? null) === null && <Check className="w-4 h-4 text-primary shrink-0" />}
            </button>
            {folders.map((f) => (
              <button
                key={f.id}
                className="mn-row"
                onClick={() => { onMoveDocuments([moveDoc.id], f.id); setMoveDoc(null); }}
              >
                <div className="w-9 h-9 rounded-lg bg-secondary/50 flex items-center justify-center text-primary/90 shrink-0">
                  <FolderOpen className="w-4.5 h-4.5" />
                </div>
                <div className="flex-1 min-w-0 text-sm font-medium truncate">{f.name}</div>
                {moveDoc.folderId === f.id && <Check className="w-4 h-4 text-primary shrink-0" />}
              </button>
            ))}
            {folders.length === 0 && (
              <p className="text-3xs text-muted-foreground/70 text-center py-4">
                No folders yet. Create one from the + button.
              </p>
            )}
          </div>
        </BottomSheet>
      )}
    </div>
  );
}

function DocSection({
  docs,
  onSelect,
  onAction,
}: {
  docs: Document[];
  onSelect: (d: Document) => void;
  onAction: (d: Document) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      {docs.map((d) => {
        const Icon = docIcon(d);
        return (
          <div key={d.id} className="mn-row !p-0 overflow-hidden">
            <button className="flex items-center gap-3 flex-1 min-w-0 px-4 py-3.5 text-left" onClick={() => onSelect(d)}>
              <div className="w-9 h-9 rounded-lg bg-secondary/50 flex items-center justify-center text-primary/90 shrink-0">
                <Icon className="w-4.5 h-4.5" />
              </div>
              <div className="text-sm font-medium truncate">{d.title}</div>
            </button>
            <button
              className="w-12 self-stretch flex items-center justify-center text-muted-foreground active:scale-90"
              onClick={() => onAction(d)}
              title="Document actions"
            >
              <MoreVertical className="w-5 h-5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

export default MobileLibrary;
