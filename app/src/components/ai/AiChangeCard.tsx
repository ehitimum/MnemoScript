import { useMemo } from 'react';
import { AlertTriangle, ArrowRight, Check, FileText, Map as MapIcon, Minus, Network, Plus, Undo2, X } from 'lucide-react';
import type { AiChat } from '../../lib/ai/useAiChat';
import type { AiChange, AiToolCallRecord } from '../../lib/ai/types';
import { wordDiff } from '../../lib/ai/diff';

interface Props {
  call: AiToolCallRecord & { change: AiChange };
  messageId: string;
  /** The reply is still running (a pending proposal can be decided). */
  live: boolean;
  chat: AiChat;
  size: 'sm' | 'lg';
}

const KIND_ICON = { text: FileText, mindmap: Network, fantasymap: MapIcon } as const;
const MAX_HUNKS = 6;
const MAX_INSERT_CHARS = 700;

const STATUS: Record<AiChange['status'], { label: string; cls: string }> = {
  pending: { label: 'Needs your OK', cls: 'text-primary bg-primary/10 border-primary/25' },
  applied: { label: 'Applied', cls: 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/25' },
  rejected: { label: 'Rejected', cls: 'text-muted-foreground bg-secondary/50 border-border/50' },
  undone: { label: 'Undone', cls: 'text-muted-foreground bg-secondary/50 border-border/50' },
  failed: { label: 'Not applied', cls: 'text-destructive bg-destructive/10 border-destructive/25' },
};

/** A proposed or applied AI change: what it does (diff), and Apply / Reject / Undo. */
export default function AiChangeCard({ call, messageId, live, chat, size }: Props) {
  const ch = call.change;
  const lg = size === 'lg';
  const Icon = KIND_ICON[ch.docType] ?? FileText;
  const status = ch.status === 'pending' && !live ? STATUS.rejected : STATUS[ch.status];
  const btn = `${lg ? 'h-9 px-4 text-sm' : 'h-7 px-3 text-xs'} inline-flex items-center gap-1.5 rounded-lg font-medium transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-default`;
  const conflict = chat.conflict?.messageId === messageId && chat.conflict.callIds[0] === call.callId ? chat.conflict : null;
  const docExists = chat.documentIds.has(ch.docId);

  return (
    <div className={`rounded-xl border overflow-hidden ${ch.status === 'pending' && live ? 'border-primary/35 bg-primary/[0.035]' : 'border-border/50 bg-secondary/20'}`}>
      <div className="flex items-center gap-2 px-3 pt-2.5 pb-2 min-w-0">
        <Icon className="w-3.5 h-3.5 text-primary shrink-0" />
        <button
          className="min-w-0 truncate text-left text-xs font-medium text-foreground hover:underline cursor-pointer disabled:no-underline disabled:cursor-default"
          onClick={() => chat.openDocument(ch.docId)}
          disabled={!docExists}
          title={docExists ? `Open “${ch.docTitle}”` : undefined}
        >
          {ch.docTitle}
        </button>
        <span className="text-3xs text-muted-foreground shrink-0">· {ch.summary}</span>
        <span className={`ml-auto shrink-0 rounded-full border px-2 py-0.5 text-3xs font-medium ${status.cls}`}>{status.label}</span>
      </div>

      <div className={`px-3 pb-2.5 overflow-y-auto overscroll-contain ${lg ? 'max-h-64' : 'max-h-52'}`}>
        <Preview change={ch} />
      </div>

      {ch.error && ch.status !== 'pending' && <p className="px-3 pb-2 text-3xs text-destructive break-words">{ch.error}</p>}

      {conflict && (
        <div className="mx-3 mb-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 flex flex-col gap-2">
          <p className="flex gap-1.5 text-xs text-foreground/90">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
            <span>
              “{conflict.docTitle}” was edited after this change. Undo anyway? Those later edits will be lost.
            </span>
          </p>
          <div className="flex justify-end gap-2">
            <button className={`${btn} text-muted-foreground hover:bg-secondary/60`} onClick={chat.dismissConflict}>
              Keep
            </button>
            <button
              className={`${btn} bg-amber-500/90 text-white hover:bg-amber-500`}
              onClick={() => void chat.undo(messageId, conflict.callIds, true)}
              disabled={chat.undoing}
            >
              Undo anyway
            </button>
          </div>
        </div>
      )}

      {ch.status === 'pending' && live && (
        <div className="flex items-center justify-end gap-2 px-3 pb-2.5">
          <button className={`${btn} text-muted-foreground hover:text-foreground hover:bg-secondary/60`} onClick={() => chat.decide([call.callId], false)}>
            <X className="w-3.5 h-3.5" /> Reject
          </button>
          <button className={`${btn} bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm`} onClick={() => chat.decide([call.callId], true)}>
            <Check className="w-3.5 h-3.5" /> Apply
          </button>
        </div>
      )}

      {ch.status === 'applied' && !conflict && (
        <div className="flex items-center justify-end px-3 pb-2">
          <button
            className={`${btn} text-muted-foreground hover:text-foreground hover:bg-secondary/60`}
            onClick={() => void chat.undo(messageId, [call.callId])}
            disabled={chat.busy || chat.undoing}
            title={chat.busy ? 'Wait for the reply to finish' : 'Put the document back as it was'}
          >
            <Undo2 className="w-3.5 h-3.5" /> Undo
          </button>
        </div>
      )}
    </div>
  );
}

function Preview({ change }: { change: AiChange }) {
  const p = change.preview;
  if (p.kind === 'list') {
    return (
      <ul className="flex flex-col gap-1 text-xs">
        {p.lines.map((l, i) => {
          const I = l.op === 'add' ? Plus : l.op === 'remove' ? Minus : ArrowRight;
          const tone = l.op === 'add' ? 'text-emerald-500' : l.op === 'remove' ? 'text-destructive' : 'text-primary';
          return (
            <li key={i} className="flex items-start gap-1.5 text-foreground/85 break-words min-w-0">
              <I className={`w-3 h-3 mt-[3px] shrink-0 ${tone}`} />
              <span className="min-w-0">{l.text}</span>
            </li>
          );
        })}
      </ul>
    );
  }
  if (!p.hunks.length) return <p className="text-xs text-muted-foreground italic">{change.created ? 'Empty document' : 'No visible text change'}</p>;
  return (
    <div className="flex flex-col gap-1.5">
      {p.hunks.slice(0, MAX_HUNKS).map((h, i) => (
        <Hunk key={i} before={h.before} after={h.after} />
      ))}
      {p.hunks.length > MAX_HUNKS && (
        <p className="text-3xs text-muted-foreground">and {p.hunks.length - MAX_HUNKS} more changed passages</p>
      )}
    </div>
  );
}

function Hunk({ before, after }: { before: string; after: string }) {
  // A brand-new passage needs no diff colouring per word; long ones are trimmed.
  const ops = useMemo(() => (before ? wordDiff(before, after) : null), [before, after]);
  const box = 'rounded-lg bg-background/60 border border-border/30 px-2.5 py-1.5 text-xs leading-relaxed whitespace-pre-wrap break-words';
  if (!ops) {
    const text = after.length > MAX_INSERT_CHARS ? `${after.slice(0, MAX_INSERT_CHARS).trimEnd()}…` : after;
    return <div className={`${box} border-l-2 border-l-emerald-500/60 text-foreground/90`}>{text}</div>;
  }
  return (
    <div className={`${box} text-foreground/80`}>
      {ops.map((o, i) =>
        o.type === 'eq' ? (
          <span key={i}>{o.text}</span>
        ) : o.type === 'del' ? (
          <del key={i} className="bg-destructive/12 text-destructive/90 decoration-destructive/50 rounded-sm">
            {o.text}
          </del>
        ) : (
          <ins key={i} className="no-underline bg-emerald-500/15 text-foreground rounded-sm">
            {o.text}
          </ins>
        ),
      )}
    </div>
  );
}
