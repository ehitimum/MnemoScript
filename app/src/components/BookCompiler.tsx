import { useEffect, useMemo, useRef, useState } from 'react';
import type { Project, Document, DocType } from '../types';
import { resolveImagesInHtml } from '../lib/assets';
import {
  BookOpen,
  ChevronUp,
  ChevronDown,
  FileDown,
  X,
  Search,
  ListFilter,
  Folder,
  FileText,
  Edit3,
  Layers,
  Map as MapIcon,
  File,
  type LucideIcon,
} from 'lucide-react';

interface BookCompilerProps {
  onClose: () => void;
  project: Project;
  documents: Document[];
}

// A document's category is derived the same way the sidebar derives its icon:
// mindmaps come from docType, the rest from a title keyword, else "custom".
type Kind = 'chapter' | 'note' | 'scene' | 'mindmap' | 'map' | 'directory' | 'custom';

interface Chapter {
  id: string;
  title: string;
  content: string;
  docType: DocType;
  kind: Kind;
  folderId: string | null;
  include: boolean;
}

const KINDS: { id: Kind; label: string; icon: LucideIcon }[] = [
  { id: 'chapter', label: 'Chapter', icon: BookOpen },
  { id: 'note', label: 'Note', icon: Edit3 },
  { id: 'scene', label: 'Scene', icon: FileText },
  { id: 'mindmap', label: 'Mind map', icon: Layers },
  { id: 'map', label: 'Fantasy map', icon: MapIcon },
  { id: 'directory', label: 'Directory', icon: Folder },
  { id: 'custom', label: 'Custom', icon: File },
];
const KIND_META = Object.fromEntries(KINDS.map((k) => [k.id, k])) as Record<Kind, (typeof KINDS)[number]>;

function kindOfDoc(d: Document): Kind {
  if (d.docType === 'mindmap') return 'mindmap';
  if (d.docType === 'fantasymap') return 'map';
  const t = d.title.toLowerCase();
  if (t.includes('chapter')) return 'chapter';
  if (t.includes('note')) return 'note';
  if (t.includes('scene')) return 'scene';
  return 'custom';
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Plain text for searching (strip HTML, or join mind-map node labels). */
function plainText(c: Chapter): string {
  if (c.kind === 'mindmap') {
    try {
      const { nodes } = JSON.parse(c.content || '{}') as { nodes?: { data?: { label?: string } }[] };
      return (nodes ?? []).map((n) => n?.data?.label ?? '').join(' ');
    } catch {
      return '';
    }
  }
  if (c.kind === 'map') {
    const m = mapSummary(c.content);
    return [...m.regions, ...m.labels].join(' ');
  }
  return c.content.replace(/<[^>]*>/g, ' ');
}

/** Pull the named regions and labels out of a fantasy-map document. */
function mapSummary(content: string): { regions: string[]; labels: string[]; kind: string } {
  try {
    const d = JSON.parse(content || '{}') as {
      kind?: string;
      regions?: { name?: string }[];
      labels?: { text?: string }[];
    };
    return {
      kind: d.kind ?? 'world',
      regions: (d.regions ?? []).map((r) => r?.name ?? '').filter(Boolean),
      labels: (d.labels ?? []).map((l) => l?.text ?? '').filter(Boolean),
    };
  } catch {
    return { regions: [], labels: [], kind: 'world' };
  }
}

/** Render a fantasy map as a printable gazetteer (named regions + labels).
 *  A full rendered-image export is a later enhancement. */
function mapToHtml(content: string): string {
  const m = mapSummary(content);
  if (!m.regions.length && !m.labels.length) return '<p><em>(Empty fantasy map)</em></p>';
  const section = (heading: string, items: string[]) =>
    items.length ? `<h3>${escapeHtml(heading)}</h3><ul>${items.map((i) => `<li>${escapeHtml(i)}</li>`).join('')}</ul>` : '';
  return (
    `<p><em>${escapeHtml(m.kind)} map</em></p>` +
    section('Regions', m.regions) +
    section('Marked places', m.labels)
  );
}

/** Render a mind map's node labels as a simple list (its content is JSON, not HTML). */
function mindmapToHtml(content: string): string {
  try {
    const { nodes } = JSON.parse(content || '{}') as { nodes?: { data?: { label?: string } }[] };
    if (!nodes?.length) return '<p><em>(Empty mind map)</em></p>';
    return `<ul>${nodes.map((n) => `<li>${escapeHtml(n?.data?.label ?? '')}</li>`).join('')}</ul>`;
  } catch {
    return '<p><em>(Mind map)</em></p>';
  }
}

const PRINT_CSS = `
  @page { size: A4; margin: 22mm 18mm; }
  * { box-sizing: border-box; }
  body { font-family: Georgia, 'Times New Roman', serif; color: #111; line-height: 1.62; font-size: 12pt; margin: 0; }
  h1, h2, h3 { font-family: Georgia, serif; line-height: 1.25; }
  img { max-width: 100%; height: auto; display: block; margin: 12pt auto; }
  blockquote { border-left: 3px solid #ccc; padding-left: 12pt; color: #444; font-style: italic; margin: 12pt 0; }
  ul, ol { padding-left: 24pt; }
  .cover { height: 100vh; display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center; page-break-after: always; }
  .cover h1 { font-size: 34pt; margin: 0 0 10pt; }
  .cover .subtitle { font-size: 16pt; font-style: italic; color: #444; margin: 0 0 60pt; }
  .cover .author { font-size: 14pt; letter-spacing: 0.5pt; }
  .toc { page-break-after: always; }
  .toc h2 { font-size: 22pt; border-bottom: 1px solid #bbb; padding-bottom: 8pt; }
  .toc ol { list-style: decimal; }
  .toc li { margin: 8pt 0; font-size: 13pt; }
  .chapter { page-break-before: always; }
  .chapter-title { font-size: 24pt; margin: 0 0 18pt; border-bottom: 2px solid #222; padding-bottom: 8pt; }
`;

// Mounted only while open (see App.tsx), so useState initializers capture the
// current project/documents — no reset effect needed.
function BookCompiler({ onClose, project, documents }: BookCompilerProps) {
  const [title, setTitle] = useState(project.name);
  const [author, setAuthor] = useState(project.author ?? '');
  const [subtitle, setSubtitle] = useState('');
  const [includeCover, setIncludeCover] = useState(true);
  const [includeToc, setIncludeToc] = useState(true);
  const [chapters, setChapters] = useState<Chapter[]>(() =>
    documents.map((d) => ({
      id: d.id,
      title: d.title,
      content: d.content,
      docType: d.docType,
      kind: kindOfDoc(d),
      folderId: d.folderId ?? null,
      include: d.docType !== 'mindmap' && d.docType !== 'fantasymap', // canvas docs off by default
    })),
  );

  const folders = useMemo(() => project.folders ?? [], [project.folders]);
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<Set<Kind>>(() => new Set(KINDS.map((k) => k.id)));
  const [filterOpen, setFilterOpen] = useState(false);
  const filterRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!filterOpen) return;
    const onDown = (e: MouseEvent) => {
      if (filterRef.current && !filterRef.current.contains(e.target as HTMLElement)) setFilterOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [filterOpen]);

  // ── Visibility (search + kind filter) ──────────────────────────────
  const q = search.trim().toLowerCase();
  const isVisible = (c: Chapter) =>
    filters.has(c.kind) && (!q || c.title.toLowerCase().includes(q) || plainText(c).toLowerCase().includes(q));
  const visibleDocs = chapters.filter(isVisible);

  // ── Directories ────────────────────────────────────────────────────
  const folderSubtree = (rootId: string): Set<string> => {
    const ids = [rootId];
    for (let i = 0; i < ids.length; i++) {
      for (const f of folders) if ((f.parentId ?? null) === ids[i]) ids.push(f.id);
    }
    return new Set(ids);
  };
  const docsInFolder = (rootId: string): Chapter[] => {
    const set = folderSubtree(rootId);
    return chapters.filter((c) => c.folderId && set.has(c.folderId));
  };
  const visibleFolders = filters.has('directory')
    ? folders.filter((f) => (!q || f.name.toLowerCase().includes(q)) && docsInFolder(f.id).length > 0)
    : [];

  const toggleDirectory = (rootId: string) => {
    const docs = docsInFolder(rootId);
    if (!docs.length) return;
    const allIn = docs.every((d) => d.include);
    const ids = new Set(docs.map((d) => d.id));
    setChapters((prev) => prev.map((c) => (ids.has(c.id) ? { ...c, include: !allIn } : c)));
  };

  // ── Selection / ordering ───────────────────────────────────────────
  const toggle = (id: string) =>
    setChapters((prev) => prev.map((c) => (c.id === id ? { ...c, include: !c.include } : c)));

  const setVisibleInclude = (val: boolean) => {
    const ids = new Set(visibleDocs.map((d) => d.id));
    setChapters((prev) => prev.map((c) => (ids.has(c.id) ? { ...c, include: val } : c)));
  };

  const toggleFilter = (k: Kind) =>
    setFilters((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  // Move a row, swapping with its neighbour in the *visible* order so reordering
  // stays intuitive even when the list is searched/filtered.
  const moveVisible = (id: string, dir: -1 | 1) => {
    setChapters((prev) => {
      const visibleIds = prev.filter(isVisible).map((c) => c.id);
      const vPos = visibleIds.indexOf(id);
      const neighborId = visibleIds[vPos + dir];
      if (neighborId == null) return prev;
      const a = prev.findIndex((c) => c.id === id);
      const b = prev.findIndex((c) => c.id === neighborId);
      const next = [...prev];
      [next[a], next[b]] = [next[b], next[a]];
      return next;
    });
  };

  const buildBookHtml = (): string => {
    const included = chapters.filter((c) => c.include);
    const cover = includeCover
      ? `<section class="cover"><h1>${escapeHtml(title)}</h1>${
          subtitle ? `<p class="subtitle">${escapeHtml(subtitle)}</p>` : ''
        }${author ? `<p class="author">${escapeHtml(author)}</p>` : ''}</section>`
      : '';
    const toc = includeToc
      ? `<section class="toc"><h2>Contents</h2><ol>${included
          .map((c) => `<li>${escapeHtml(c.title)}</li>`)
          .join('')}</ol></section>`
      : '';
    const body = included
      .map(
        (c) =>
          `<section class="chapter"><h1 class="chapter-title">${escapeHtml(c.title)}</h1>${
            c.kind === 'mindmap' ? mindmapToHtml(c.content)
              : c.kind === 'map' ? mapToHtml(c.content)
                : resolveImagesInHtml(c.content)
          }</section>`,
      )
      .join('');
    return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(
      title,
    )}</title><style>${PRINT_CSS}</style></head><body>${cover}${toc}${body}</body></html>`;
  };

  const handleExport = () => {
    const html = buildBookHtml();
    const iframe = document.createElement('iframe');
    iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
    document.body.appendChild(iframe);
    const cw = iframe.contentWindow;
    if (!cw) {
      document.body.removeChild(iframe);
      return;
    }
    cw.document.open();
    cw.document.write(html);
    cw.document.close();
    // Allow images/fonts to settle, then hand off to the OS print → "Save as PDF".
    setTimeout(() => {
      cw.focus();
      cw.print();
      setTimeout(() => document.body.removeChild(iframe), 1500);
    }, 400);
  };

  const includedCount = chapters.filter((c) => c.include).length;
  const allFilters = filters.size === KINDS.length;
  const field =
    'w-full bg-secondary/35 border border-border/30 text-foreground text-sm rounded-lg px-3 py-2.5 focus:border-primary/50 focus:ring-1 focus:ring-primary/20 outline-none transition-all placeholder:text-muted-foreground/50';

  return (
    <div className="fixed inset-0 bg-background/60 backdrop-blur-md z-2000 flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="bg-popover border border-border/40 shadow-2xl rounded-2xl w-full max-w-lg max-h-[90vh] overflow-hidden flex flex-col animate-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center gap-3 px-6 py-4 border-b border-border/20">
          <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
            <BookOpen className="w-4 h-4" />
          </div>
          <h3 className="text-base font-semibold text-foreground flex-1">Compile to PDF Book</h3>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-md text-muted-foreground hover:bg-secondary/60 hover:text-foreground cursor-pointer transition-all"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-2xs font-semibold text-muted-foreground uppercase tracking-wider">Book Title</label>
              <input className={field} value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <label className="text-2xs font-semibold text-muted-foreground uppercase tracking-wider">Author</label>
                <input className={field} value={author} placeholder="Your name" onChange={(e) => setAuthor(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-2xs font-semibold text-muted-foreground uppercase tracking-wider">Subtitle</label>
                <input className={field} value={subtitle} placeholder="Optional" onChange={(e) => setSubtitle(e.target.value)} />
              </div>
            </div>
          </div>

          <div className="flex gap-5">
            <label className="flex items-center gap-2 text-xs text-foreground cursor-pointer">
              <input type="checkbox" className="accent-primary w-4 h-4 cursor-pointer" checked={includeCover} onChange={(e) => setIncludeCover(e.target.checked)} />
              Cover page
            </label>
            <label className="flex items-center gap-2 text-xs text-foreground cursor-pointer">
              <input type="checkbox" className="accent-primary w-4 h-4 cursor-pointer" checked={includeToc} onChange={(e) => setIncludeToc(e.target.checked)} />
              Table of contents
            </label>
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-2xs font-semibold text-muted-foreground uppercase tracking-wider">
              Chapters &amp; Order ({includedCount} included)
            </label>

            {/* Search + filter */}
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/60 pointer-events-none" />
                <input
                  className={`${field} pl-9`}
                  value={search}
                  placeholder="Search title or content…"
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <div ref={filterRef} className="relative">
                <button
                  onClick={() => setFilterOpen((o) => !o)}
                  className="flex items-center gap-1.5 text-xs font-medium px-3 py-2.5 rounded-lg border border-border/30 text-foreground hover:bg-secondary/60 cursor-pointer transition-all"
                  title="Filter what to show"
                  aria-expanded={filterOpen}
                >
                  <ListFilter className="w-3.5 h-3.5" /> Filter
                  {!allFilters && (
                    <span className="ml-0.5 min-w-4 h-4 px-1 inline-flex items-center justify-center rounded-full bg-primary text-primary-foreground text-[10px] font-semibold">
                      {filters.size}
                    </span>
                  )}
                </button>
                {filterOpen && (
                  <div className="absolute right-0 top-full mt-1.5 z-10 w-48 p-1.5 rounded-xl border border-border/60 bg-popover text-popover-foreground shadow-[0_12px_40px_rgba(0,0,0,0.35)]">
                    {KINDS.map(({ id, label, icon: Icon }) => (
                      <button
                        key={id}
                        type="button"
                        onClick={() => toggleFilter(id)}
                        className="flex items-center gap-2.5 w-full text-left px-2 py-1.5 rounded-md cursor-pointer hover:bg-secondary/60 transition-colors"
                      >
                        <input type="checkbox" readOnly checked={filters.has(id)} className="accent-primary w-3.5 h-3.5 pointer-events-none" />
                        <Icon className="w-3.5 h-3.5 text-muted-foreground" />
                        <span className="text-sm">{label}</span>
                      </button>
                    ))}
                    <div className="flex gap-1 mt-1 pt-1 border-t border-border/30">
                      <button onClick={() => setFilters(new Set(KINDS.map((k) => k.id)))} className="flex-1 text-[11px] font-medium py-1 rounded-md text-foreground/80 hover:bg-secondary/60 cursor-pointer transition-colors">
                        All
                      </button>
                      <button onClick={() => setFilters(new Set())} className="flex-1 text-[11px] font-medium py-1 rounded-md text-foreground/80 hover:bg-secondary/60 cursor-pointer transition-colors">
                        None
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Select all / none */}
            <div className="flex items-center justify-between px-0.5">
              <span className="text-[11px] text-muted-foreground/70">
                {visibleDocs.length} shown{visibleFolders.length ? ` · ${visibleFolders.length} folders` : ''}
              </span>
              <div className="flex items-center gap-2 text-[11px] font-medium">
                <button onClick={() => setVisibleInclude(true)} disabled={!visibleDocs.length} className="text-primary hover:underline disabled:opacity-40 disabled:no-underline cursor-pointer disabled:cursor-not-allowed">
                  Select all
                </button>
                <span className="text-border">|</span>
                <button onClick={() => setVisibleInclude(false)} disabled={!visibleDocs.length} className="text-muted-foreground hover:text-foreground hover:underline disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed">
                  Unselect all
                </button>
              </div>
            </div>

            <div className="flex flex-col gap-1 max-h-64 overflow-y-auto rounded-lg border border-border/30 p-1.5 bg-secondary/15">
              {chapters.length === 0 ? (
                <p className="text-xs text-muted-foreground/70 italic px-2 py-3 text-center">No documents to compile.</p>
              ) : visibleFolders.length === 0 && visibleDocs.length === 0 ? (
                <p className="text-xs text-muted-foreground/70 italic px-2 py-3 text-center">Nothing matches your search/filter.</p>
              ) : (
                <>
                  {/* Directory rows — toggling one selects/deselects everything inside it. */}
                  {visibleFolders.map((f) => {
                    const docs = docsInFolder(f.id);
                    const sel = docs.filter((d) => d.include).length;
                    const all = sel === docs.length;
                    return (
                      <div key={`f-${f.id}`} className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-secondary/40 transition-colors">
                        <input
                          type="checkbox"
                          className="accent-primary w-4 h-4 cursor-pointer"
                          checked={all}
                          ref={(el) => {
                            if (el) el.indeterminate = sel > 0 && !all;
                          }}
                          onChange={() => toggleDirectory(f.id)}
                        />
                        <Folder className="w-3.5 h-3.5 text-amber-500/80 shrink-0" />
                        <span className="flex-1 text-sm font-medium truncate text-foreground">{f.name}</span>
                        <span className="text-[10px] text-muted-foreground/70 shrink-0">{sel}/{docs.length}</span>
                      </div>
                    );
                  })}

                  {visibleFolders.length > 0 && visibleDocs.length > 0 && (
                    <div className="h-px bg-border/30 mx-2 my-1" />
                  )}

                  {/* Document rows */}
                  {visibleDocs.map((c, i) => {
                    const Icon = KIND_META[c.kind].icon;
                    return (
                      <div key={c.id} className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-secondary/40 transition-colors">
                        <input type="checkbox" className="accent-primary w-4 h-4 cursor-pointer" checked={c.include} onChange={() => toggle(c.id)} />
                        <Icon className="w-3.5 h-3.5 text-muted-foreground/80 shrink-0" />
                        <span className={`flex-1 text-sm truncate ${c.include ? 'text-foreground' : 'text-muted-foreground/60 line-through'}`}>{c.title}</span>
                        <button onClick={() => moveVisible(c.id, -1)} disabled={i === 0} className="w-6 h-6 flex items-center justify-center rounded text-muted-foreground hover:text-primary hover:bg-secondary/60 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition-all">
                          <ChevronUp className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => moveVisible(c.id, 1)} disabled={i === visibleDocs.length - 1} className="w-6 h-6 flex items-center justify-center rounded text-muted-foreground hover:text-primary hover:bg-secondary/60 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition-all">
                          <ChevronDown className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    );
                  })}
                </>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground/70">
              Export opens your system print dialog — choose <strong>“Save as PDF”</strong> as the destination.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 px-6 py-4 border-t border-border/20">
          <button onClick={onClose} className="bg-secondary hover:bg-secondary/80 text-foreground px-4 py-2.5 text-xs font-semibold rounded-lg cursor-pointer transition-all border border-border/30">
            Cancel
          </button>
          <button
            onClick={handleExport}
            disabled={includedCount === 0}
            className="flex items-center gap-2 bg-primary text-primary-foreground hover:opacity-95 disabled:opacity-40 disabled:cursor-not-allowed px-5 py-2.5 text-xs font-semibold rounded-lg cursor-pointer shadow-xs active:scale-98 transition-all"
          >
            <FileDown className="w-3.5 h-3.5" />
            Export PDF
          </button>
        </div>
      </div>
    </div>
  );
}

export default BookCompiler;
