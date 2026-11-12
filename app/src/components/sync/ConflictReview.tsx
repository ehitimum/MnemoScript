import { useEffect, useMemo, useState } from 'react';
import { Check, Loader2, Merge, X } from 'lucide-react';
import { api } from '../../lib/api';
import type { ConflictVersion } from '../../lib/sync/types';
import type { DocType } from '../../types';
import { paragraphs, wordCount as words } from '../../lib/sync/preview';

/**
 * Side-by-side review of a chapter edited on two devices. The writer picks the version to keep
 * in place; by default every other version is saved as its own chapter, so nothing is lost.
 */
export default function ConflictReview({ projectId, documentId, title, docType, variant, onClose, onResolved }: {
  projectId: string;
  documentId: string;
  title: string;
  docType: DocType;
  variant: 'desktop' | 'mobile';
  onClose: () => void;
  onResolved: (copies: string[]) => void;
}) {
  const [versions, setVersions] = useState<ConflictVersion[] | null>(null);
  const [error, setError] = useState('');
  const [keepCopies, setKeepCopies] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api.syncConflict(projectId, documentId)
      .then((v) => live && setVersions(v))
      .catch((e) => live && setError(e instanceof Error ? e.message : String(e)));
    return () => { live = false; };
  }, [projectId, documentId]);

  const parsed = useMemo(() => (versions ?? []).map((v) => ({ ...v, paras: paragraphs(v.content, docType) })), [versions, docType]);
  const everyPara = useMemo(() => parsed.map((v) => new Set(v.paras)), [parsed]);

  const keep = (rev: string) => {
    setBusy(rev);
    setError('');
    api.syncResolveConflict(projectId, documentId, rev, keepCopies)
      .then(onResolved)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(null));
  };

  const desktop = variant === 'desktop';
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/45 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={`Compare versions of ${title}`}>
      <div className={`bg-background border border-border/50 shadow-2xl flex flex-col ${desktop ? 'w-[min(64rem,calc(100vw-3rem))] max-h-[85vh] rounded-2xl' : 'w-full max-h-[92vh] rounded-t-3xl'}`}>
        <header className="flex items-start gap-3 px-5 pt-5 pb-3">
          <div className="w-9 h-9 rounded-xl bg-amber-500/12 text-amber-500 flex items-center justify-center shrink-0"><Merge className="w-4.5 h-4.5" /></div>
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-semibold tracking-tight text-foreground truncate">{title}</h2>
            <p className="text-xs text-muted-foreground leading-relaxed">Edited on two devices before they could sync. Choose the version to keep in place. Highlighted paragraphs differ.</p>
          </div>
          <button className="w-8 h-8 flex items-center justify-center rounded-lg text-muted-foreground hover:bg-secondary/60 cursor-pointer" onClick={onClose} aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </header>

        <div className={`flex-1 min-h-0 overflow-y-auto px-5 pb-3 grid gap-3 ${desktop ? 'grid-cols-2' : 'grid-cols-1'}`}>
          {!versions && !error && (
            <div className="col-span-full flex items-center gap-2 text-sm text-muted-foreground py-10 justify-center"><Loader2 className="w-4 h-4 animate-spin" />Loading both versions…</div>
          )}
          {parsed.map((v, i) => (
            <article key={v.rev} className="flex flex-col rounded-xl border border-border/40 bg-card/50 min-h-0">
              <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-border/30">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-foreground truncate">{v.local ? 'On this device' : `From ${v.device}`}</div>
                  <div className="text-3xs text-muted-foreground">{docType === 'text' ? `${words(v.paras)} words` : 'Map version'}{v.local ? ` · ${v.device}` : ''}</div>
                </div>
                <button
                  className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:opacity-90 disabled:opacity-60 cursor-pointer"
                  disabled={!!busy}
                  onClick={() => keep(v.rev)}
                >
                  {busy === v.rev ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}Keep this
                </button>
              </div>
              <div className={`px-4 py-3 flex flex-col gap-2.5 font-serif text-[0.95rem] leading-relaxed text-foreground/90 ${desktop ? 'max-h-[52vh] overflow-y-auto' : ''}`}>
                {v.paras.map((p, k) => {
                  const unique = everyPara.some((set, j) => j !== i && !set.has(p));
                  return (
                    <p key={k} className={unique ? 'rounded-md -mx-1.5 px-1.5 bg-primary/10' : ''}>{p}</p>
                  );
                })}
              </div>
            </article>
          ))}
        </div>

        <footer className="px-5 py-3.5 border-t border-border/30 flex flex-col sm:flex-row sm:items-center gap-3">
          <label className="flex items-start gap-2.5 text-xs text-foreground/85 cursor-pointer flex-1">
            <input type="checkbox" className="mt-0.5 w-4 h-4 accent-primary cursor-pointer" checked={keepCopies} onChange={(e) => setKeepCopies(e.target.checked)} />
            <span>Also keep the other version as its own chapter, next to this one{!keepCopies && <span className="block text-muted-foreground mt-0.5">It stays in sync history but won't appear in your project.</span>}</span>
          </label>
          {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
        </footer>
      </div>
    </div>
  );
}
