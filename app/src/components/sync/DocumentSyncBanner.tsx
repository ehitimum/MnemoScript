import { useState } from 'react';
import { Loader2, Merge, RefreshCw } from 'lucide-react';
import { projectSync } from '../../lib/sync/useSync';
import type { SyncStatus } from '../../lib/sync/types';

/**
 * A floating note over the open chapter when another device changed it. Incoming text is never
 * swapped in under the writer: they choose when to load it, and parallel edits go to review.
 */
export default function DocumentSyncBanner({ status, projectId, documentId, onLoadUpdate, onReview, variant }: {
  status: SyncStatus;
  projectId?: string;
  documentId?: string;
  onLoadUpdate: () => Promise<void>;
  onReview: () => void;
  variant: 'desktop' | 'mobile';
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const project = projectSync(status, projectId);
  if (!project || !documentId) return null;
  const conflict = project.conflicts.some((c) => c.docId === documentId);
  const staged = project.staged.includes(documentId);
  if (!conflict && !staged) return null;

  const shell = variant === 'desktop'
    ? 'absolute top-3 left-1/2 -translate-x-1/2 z-20 max-w-[min(36rem,calc(100%-2rem))]'
    : 'absolute top-2 inset-x-3 z-20';
  return (
    <div className={shell} role="status">
      <div className="flex items-center gap-3 pl-3.5 pr-2 py-2 rounded-2xl border border-border/50 bg-card/95 backdrop-blur-md shadow-lg">
        {conflict ? <Merge className="w-4 h-4 text-amber-500 shrink-0" /> : <RefreshCw className="w-4 h-4 text-primary shrink-0" />}
        <p className="text-xs text-foreground/90 leading-snug flex-1">
          {conflict
            ? 'This chapter was also changed on another device. Both versions are safe.'
            : 'A newer version of this chapter arrived from another device.'}
          {error && <span className="block text-destructive mt-0.5">{error}</span>}
        </p>
        <button
          className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-primary text-primary-foreground text-xs font-medium hover:opacity-90 disabled:opacity-60 cursor-pointer"
          disabled={busy}
          onClick={() => {
            if (conflict) return onReview();
            setBusy(true);
            setError('');
            onLoadUpdate()
              .catch((e) => setError(e instanceof Error ? e.message : String(e)))
              .finally(() => setBusy(false));
          }}
        >
          {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          {conflict ? 'Compare versions' : 'Load it'}
        </button>
      </div>
    </div>
  );
}
