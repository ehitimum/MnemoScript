import { useEffect, useRef } from 'react';
import { AlertTriangle, BookOpenText, Check, KeyRound, ListTree, PencilLine, Sparkles, Terminal, Undo2 } from 'lucide-react';
import type { Document } from '../../types';
import type { AiChat } from '../../lib/ai/useAiChat';
import type { AiChange, AiMessage, AiToolCallRecord } from '../../lib/ai/types';
import AiChangeCard from './AiChangeCard';
import { describeToolCall } from '../../lib/ai/format';
import { modelLabel } from '../../lib/ai/providers';
import Markdown from './Markdown';
import ModelBadge from './ModelBadge';

type Size = 'sm' | 'lg';

interface Props {
  chat: AiChat;
  documents: Document[];
  size: Size;
}

/** Scrollable transcript (or the welcome state for a new session). */
export default function AiMessages({ chat, documents, size }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const messages = chat.session?.messages ?? [];

  // Follow the reply as it streams, unless the writer scrolled up to read.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [chat.session]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (el) stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  const text = size === 'lg' ? 'text-[15px]' : 'text-[13px]';
  const pad = size === 'lg' ? 'px-4' : 'px-3.5';

  if (!messages.length) {
    return <Welcome chat={chat} size={size} />;
  }

  return (
    <div ref={scrollRef} onScroll={onScroll} className={`flex-1 min-h-0 overflow-y-auto overscroll-contain ${pad} py-4`}>
      <div className={`flex flex-col gap-5 ${text} leading-relaxed`}>
        {messages.map((m) =>
          m.role === 'user' ? (
            <div key={m.id} className="self-end max-w-[85%] rounded-2xl rounded-br-md bg-primary/12 border border-primary/20 px-3.5 py-2 text-foreground whitespace-pre-wrap break-words">
              {m.text}
            </div>
          ) : (
            <AssistantMessage key={m.id} m={m} chat={chat} documents={documents} size={size} />
          ),
        )}
      </div>
    </div>
  );
}

type ChangeCall = AiToolCallRecord & { change: AiChange };

function AssistantMessage({ m, chat, documents, size }: { m: AiMessage; chat: AiChat; documents: Document[]; size: Size }) {
  const calls = m.toolCalls ?? [];
  const chips = calls.filter((c) => !c.change);
  const changes = calls.filter((c): c is ChangeCall => !!c.change);
  const pending = changes.filter((c) => c.change.status === 'pending');
  const applied = changes.filter((c) => c.change.status === 'applied');
  const awaiting = !!m.pending && pending.length > 0;
  const thinking = m.pending && !m.text && !awaiting;
  const link = 'inline-flex items-center gap-1.5 text-3xs font-medium text-muted-foreground hover:text-foreground cursor-pointer disabled:opacity-40 disabled:cursor-default';
  return (
    <div className="flex flex-col gap-2 min-w-0">
      {!!chips.length && (
        <div className="flex flex-wrap gap-1.5">
          {chips.map((c) => (
            <span
              key={c.callId}
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-3xs font-medium ${
                c.isError ? 'border-destructive/30 text-destructive/90 bg-destructive/5' : 'border-border/40 text-muted-foreground bg-secondary/30'
              }`}
            >
              {c.name === 'list_documents' ? (
                <ListTree className="w-3 h-3" />
              ) : c.name === 'read_document' ? (
                <BookOpenText className="w-3 h-3" />
              ) : (
                <PencilLine className="w-3 h-3" />
              )}
              {describeToolCall(c, documents)}
              {c.result != null && !c.isError && <Check className="w-3 h-3 text-primary/80" />}
            </span>
          ))}
        </div>
      )}

      {changes.map((c) => (
        <AiChangeCard key={c.callId} call={c} messageId={m.id} live={!!m.pending} chat={chat} size={size} />
      ))}

      {awaiting && pending.length > 1 && (
        <div className="flex items-center justify-end gap-3">
          <button className={link} onClick={() => chat.decide(pending.map((c) => c.callId), false)}>
            Reject all
          </button>
          <button
            className="inline-flex items-center gap-1.5 text-3xs font-medium text-primary hover:underline cursor-pointer"
            onClick={() => chat.decide(pending.map((c) => c.callId), true)}
          >
            <Check className="w-3 h-3" /> Apply all {pending.length}
          </button>
        </div>
      )}

      {awaiting && (
        <p className="flex items-center gap-1.5 text-3xs text-primary/90" role="status">
          <span className="mn-ai-dot" /> Waiting for you to apply or reject
        </p>
      )}

      {m.text && <Markdown text={m.text} className="text-foreground/90 break-words" />}

      {thinking && (
        <div className="flex items-center gap-1.5 h-6 text-muted-foreground" aria-label="Thinking">
          <span className="mn-ai-dot" />
          <span className="mn-ai-dot" style={{ animationDelay: '0.15s' }} />
          <span className="mn-ai-dot" style={{ animationDelay: '0.3s' }} />
        </div>
      )}

      {m.error && m.error.kind !== 'cancelled' && <ErrorCard m={m} chat={chat} />}
      {m.error?.kind === 'cancelled' && <span className="text-3xs text-muted-foreground/70 italic">Stopped</span>}

      {!m.pending && (m.model || m.usage || applied.length > 1) && (
        <div className="flex items-center gap-1.5 text-3xs text-muted-foreground/60">
          {m.model && <ModelBadge model={m.model} size="xs" />}
          {m.model && <span>{modelLabel(m.model)}</span>}
          {m.usage?.costUsd != null && m.usage.costUsd > 0 && <span>· ${m.usage.costUsd.toFixed(3)}</span>}
          {applied.length > 1 && (
            <button
              className={`${link} ml-auto`}
              onClick={() => void chat.undo(m.id, applied.map((c) => c.callId).reverse())}
              disabled={chat.busy || chat.undoing}
            >
              <Undo2 className="w-3 h-3" /> Undo all {applied.length}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function ErrorCard({ m, chat }: { m: AiMessage; chat: AiChat }) {
  const err = m.error!;
  const isCli = m.provider === 'claude-code';
  const title =
    err.kind === 'auth'
      ? isCli ? 'Claude Code isn’t signed in' : 'This provider needs an API key'
      : err.kind === 'rate_limit'
        ? 'Usage limit reached'
        : err.kind === 'refusal'
          ? 'The model declined this request'
          : err.kind === 'unavailable'
            ? 'This AI isn’t available'
            : 'Something went wrong';
  return (
    <div className="rounded-xl border border-destructive/25 bg-destructive/[0.06] px-3 py-2.5 flex flex-col gap-2">
      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
        <AlertTriangle className="w-4 h-4 text-destructive shrink-0" />
        {title}
      </div>
      <p className="text-xs text-muted-foreground break-words">{err.message}</p>
      {err.kind === 'auth' && isCli && (
        <code className="flex items-center gap-2 self-start rounded-md bg-secondary/70 px-2 py-1 text-xs font-mono text-foreground">
          <Terminal className="w-3.5 h-3.5 text-primary" /> claude auth login
        </code>
      )}
      {(err.kind === 'auth' || err.kind === 'unavailable') && (
        <button
          className="self-start inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline cursor-pointer"
          onClick={() => (isCli ? chat.refreshStatus() : chat.setView('connect'))}
        >
          {isCli ? <Check className="w-3.5 h-3.5" /> : <KeyRound className="w-3.5 h-3.5" />}
          {isCli ? 'I’ve signed in — check again' : 'Add a key'}
        </button>
      )}
    </div>
  );
}

const SUGGESTIONS = [
  { label: 'What’s in this project?', prompt: 'Give me a short overview of what is in this project so far.' },
  { label: 'Summarise this chapter', prompt: 'Summarise the document I have open in a few sentences.', needsDoc: true },
  { label: 'Check continuity', prompt: 'Read the open document and point out any continuity problems or loose threads.', needsDoc: true },
];

function Welcome({ chat, size }: { chat: AiChat; size: Size }) {
  const lg = size === 'lg';
  return (
    <div className="flex-1 min-h-0 overflow-y-auto flex flex-col items-center justify-center gap-5 px-6 py-8 text-center">
      <div className={`${lg ? 'w-16 h-16' : 'w-12 h-12'} rounded-2xl bg-primary/10 flex items-center justify-center text-primary`}>
        <Sparkles className={lg ? 'w-7 h-7' : 'w-5 h-5'} />
      </div>
      <div className="flex flex-col gap-1.5">
        <p className={`${lg ? 'text-base' : 'text-sm'} font-medium text-foreground`}>Ask about your story</p>
        <p className="text-xs text-muted-foreground max-w-[30ch] mx-auto leading-relaxed">
          The assistant can read your chapters, mind maps and maps. It only sees this project.
        </p>
      </div>
      {chat.ready && (
        <div className="flex flex-col gap-2 w-full max-w-[280px]">
          {SUGGESTIONS.filter((s) => !s.needsDoc || chat.activeDocument).map((s) => (
            <button
              key={s.label}
              onClick={() => chat.send(s.prompt)}
              className={`${lg ? 'mn-row text-sm' : 'w-full text-left px-3 py-2 rounded-lg border border-border/40 bg-secondary/25 hover:bg-secondary/50 hover:border-primary/40 text-xs text-foreground/85 transition-all cursor-pointer'}`}
            >
              {s.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
