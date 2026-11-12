import { useState } from 'react';
import { MessageSquarePlus, Trash2 } from 'lucide-react';
import type { AiChat } from '../../lib/ai/useAiChat';
import { relativeTime } from '../../lib/ai/format';
import { ModelStack } from './ModelBadge';

/** This project's sessions, newest first. Each row shows the models that answered in it. */
export default function AiSessions({ chat, size, projectName }: { chat: AiChat; size: 'sm' | 'lg'; projectName: string }) {
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const lg = size === 'lg';
  const sessions = chat.sessions;

  return (
    <div className={`flex-1 min-h-0 overflow-y-auto overscroll-contain ${lg ? 'px-4 py-4' : 'px-2.5 py-3'} flex flex-col gap-2`}>
      <div className="flex items-center justify-between px-1 pb-1">
        <span className="text-3xs font-semibold tracking-[0.12em] uppercase text-muted-foreground/70 truncate">
          Sessions · {projectName}
        </span>
        <button
          onClick={chat.startNew}
          disabled={chat.busy}
          className={`inline-flex items-center gap-1.5 rounded-lg font-medium text-primary hover:bg-primary/10 transition-all cursor-pointer disabled:opacity-40 ${lg ? 'h-9 px-3 text-sm' : 'h-7 px-2 text-xs'}`}
        >
          <MessageSquarePlus className="w-3.5 h-3.5" /> New
        </button>
      </div>

      {sessions == null ? (
        <p className="text-xs text-muted-foreground px-1">Loading…</p>
      ) : sessions.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-10 text-center">
          <p className="text-sm text-foreground/80">No sessions yet</p>
          <p className="text-xs text-muted-foreground max-w-[26ch]">Sessions you start in this project are kept here, and only here.</p>
        </div>
      ) : (
        sessions.map((s) => {
          const active = chat.session?.id === s.id;
          return (
            <div
              key={s.id}
              className={`group flex items-center gap-3 rounded-xl border transition-all ${lg ? 'px-3.5 py-3' : 'px-2.5 py-2'} ${
                active ? 'border-primary/45 bg-primary/[0.07]' : 'border-border/30 bg-secondary/20 hover:bg-secondary/45 hover:border-border/60'
              }`}
            >
              <button className="flex items-center gap-3 flex-1 min-w-0 text-left cursor-pointer" onClick={() => chat.openSession(s.id)} disabled={chat.busy}>
                <ModelStack models={s.models} size={lg ? 'sm' : 'xs'} />
                <span className="flex flex-col min-w-0">
                  <span className={`truncate text-foreground ${lg ? 'text-sm' : 'text-xs font-medium'}`}>{s.title || 'Untitled session'}</span>
                  <span className="text-3xs text-muted-foreground/70 truncate">
                    {relativeTime(s.updatedAt)} · {Math.ceil(s.messageCount / 2)} {s.messageCount > 2 ? 'turns' : 'turn'}
                  </span>
                </span>
              </button>
              {confirmId === s.id ? (
                <span className="flex items-center gap-1 shrink-0">
                  <button className={`rounded-md px-2 text-3xs font-medium bg-destructive/15 text-destructive cursor-pointer ${lg ? 'h-8' : 'h-6'}`} onClick={() => { chat.deleteSession(s.id); setConfirmId(null); }}>
                    Delete
                  </button>
                  <button className={`rounded-md px-2 text-3xs text-muted-foreground cursor-pointer ${lg ? 'h-8' : 'h-6'}`} onClick={() => setConfirmId(null)}>
                    Keep
                  </button>
                </span>
              ) : (
                <button
                  className={`shrink-0 flex items-center justify-center rounded-md text-muted-foreground/60 hover:text-destructive hover:bg-secondary transition-all cursor-pointer ${lg ? 'w-9 h-9' : 'w-6 h-6 opacity-0 group-hover:opacity-100 focus:opacity-100'}`}
                  onClick={() => setConfirmId(s.id)}
                  title="Delete session"
                  disabled={chat.busy}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
