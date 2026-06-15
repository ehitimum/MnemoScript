import { useState } from 'react';
import type { Project, Document } from '../types';
import { resolveImagesInHtml } from '../lib/assets';
import { BookOpen, ChevronUp, ChevronDown, FileDown, X } from 'lucide-react';

interface BookCompilerProps {
  onClose: () => void;
  project: Project;
  documents: Document[];
}

interface Chapter {
  id: string;
  title: string;
  content: string;
  include: boolean;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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
    documents
      .filter((d) => d.docType !== 'mindmap')
      .map((d) => ({ id: d.id, title: d.title, content: d.content, include: true })),
  );

  const move = (index: number, dir: -1 | 1) => {
    setChapters((prev) => {
      const next = [...prev];
      const target = index + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const toggle = (id: string) =>
    setChapters((prev) => prev.map((c) => (c.id === id ? { ...c, include: !c.include } : c)));

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
          `<section class="chapter"><h1 class="chapter-title">${escapeHtml(
            c.title,
          )}</h1>${resolveImagesInHtml(c.content)}</section>`,
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

          <div className="flex flex-col gap-1.5">
            <label className="text-2xs font-semibold text-muted-foreground uppercase tracking-wider">
              Chapters &amp; Order ({includedCount} included)
            </label>
            <div className="flex flex-col gap-1 max-h-64 overflow-y-auto rounded-lg border border-border/30 p-1.5 bg-secondary/15">
              {chapters.length === 0 ? (
                <p className="text-xs text-muted-foreground/70 italic px-2 py-3 text-center">No text chapters to compile.</p>
              ) : (
                chapters.map((c, i) => (
                  <div key={c.id} className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-secondary/40 transition-colors">
                    <input type="checkbox" className="accent-primary w-4 h-4 cursor-pointer" checked={c.include} onChange={() => toggle(c.id)} />
                    <span className={`flex-1 text-sm truncate ${c.include ? 'text-foreground' : 'text-muted-foreground/60 line-through'}`}>{c.title}</span>
                    <button onClick={() => move(i, -1)} disabled={i === 0} className="w-6 h-6 flex items-center justify-center rounded text-muted-foreground hover:text-primary hover:bg-secondary/60 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition-all">
                      <ChevronUp className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => move(i, 1)} disabled={i === chapters.length - 1} className="w-6 h-6 flex items-center justify-center rounded text-muted-foreground hover:text-primary hover:bg-secondary/60 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition-all">
                      <ChevronDown className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))
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
