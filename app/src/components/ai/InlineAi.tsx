import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react';
import type { Editor as TiptapEditor } from '@tiptap/react';
import type { EditorState } from '@tiptap/pm/state';
import { ArrowLeft, Check, ChevronRight, KeyRound, RotateCcw, Sparkles, X } from 'lucide-react';
import {
  buildInlinePrompt,
  cleanInlineOutput,
  INLINE_COMMANDS,
  inlineCommand,
  TONES,
  type InlineCommandId,
  type ToneId,
} from '../../lib/ai/inline';
import { applyRewrite, flatten, insertParagraphsAfter } from '../../lib/ai/rewrite';
import { wordDiff } from '../../lib/ai/diff';
import type { InlineAiHost } from '../../lib/ai/inlineHost';
import { modelLabel as prettyModel } from '../../lib/ai/providers';
import { getAiTarget, registerInlineAi, setAiTarget } from '../extensions/AiTarget';
import { INLINE_ICONS } from './inlineIcons';

interface Props {
  editor: TiptapEditor | null;
  /** The project's AI (absent outside a project, e.g. in isolated tests). */
  host?: InlineAiHost;
  /** Phone: the card docks to the bottom of the editor; no selection bubble or menu. */
  mobile: boolean;
  scrollRef: RefObject<HTMLDivElement | null>;
}

type Status = 'running' | 'done' | 'error' | 'unavailable';

interface Job {
  id: number;
  cmd: InlineCommandId;
  tone?: ToneId;
  original: string;
  result: string;
  status: Status;
  error?: string;
  model?: string;
  showDiff: boolean;
}

interface Anchor {
  left: number;
  top?: number;
  bottom?: number;
}

interface Menu {
  anchor: Anchor;
  tone: boolean;
  index: number;
  scope: 'selection' | 'paragraph';
}

const CARD_W = 460;
const MAX_CHARS = 15000;
const tail = (s: string, n: number) => (s.length > n ? s.slice(s.length - n) : s);

/** The paragraph at `pos`, or the closest non-empty one before it. */
function paragraphAround(state: EditorState, pos: number): { from: number; to: number } {
  const $p = state.doc.resolve(pos);
  if ($p.parent.isTextblock && $p.parent.textContent.trim()) return { from: $p.start(), to: $p.end() };
  let last: { from: number; to: number } | null = null;
  state.doc.nodesBetween(0, pos, (node, at) => {
    if (node.isTextblock && node.textContent.trim()) last = { from: at + 1, to: at + 1 + node.content.size };
    return !node.isTextblock;
  });
  return last ?? { from: pos, to: pos };
}

/**
 * Inline AI commands in the editor: the preview card (streams the revision, shows a diff, Accept /
 * Retry / Discard), the desktop command menu (Ctrl/⌘+J or the ✦ button on a selection), and the
 * controller the slash menu and Tools sheet use. Nothing touches the document until Accept, which
 * is a single undo step.
 */
export default function InlineAi({ editor, host, mobile, scrollRef }: Props) {
  const [job, setJob] = useState<Job | null>(null);
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [bubble, setBubble] = useState<{ left: number; top: number } | null>(null);
  const hostRef = useRef(host);
  const runRef = useRef<{ cancel: () => void } | null>(null);
  const jobIdRef = useRef(0);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuNowRef = useRef(menu);
  useEffect(() => {
    hostRef.current = host;
    menuNowRef.current = menu;
  });

  const place = useCallback(
    (from: number, to: number): Anchor | null => {
      if (!editor || mobile || editor.isDestroyed) return null;
      try {
        const start = editor.view.coordsAtPos(from);
        const end = editor.view.coordsAtPos(to);
        const w = Math.min(CARD_W, window.innerWidth - 16);
        const left = Math.max(8, Math.min(start.left, window.innerWidth - w - 8));
        return window.innerHeight - end.bottom > 280 ? { left, top: end.bottom + 8 } : { left, bottom: window.innerHeight - start.top + 8 };
      } catch {
        return null;
      }
    },
    [editor, mobile],
  );

  const start = useCallback(
    (cmd: InlineCommandId, opts?: { tone?: ToneId; range?: { from: number; to: number } }) => {
      if (!editor || editor.isDestroyed) return;
      runRef.current?.cancel();
      runRef.current = null;
      setMenu(null);
      setBubble(null);
      const { state } = editor;
      const sel = state.selection;
      let range: { from: number; to: number };
      if (opts?.range) range = opts.range;
      else if (cmd === 'continue') {
        const end = sel.$to.parent.isTextblock ? sel.$to.end() : sel.to;
        range = { from: end, to: end };
      } else if (!sel.empty) range = { from: sel.from, to: sel.to };
      else range = paragraphAround(state, sel.from);
      const { from, to } = range;

      const passage = cmd === 'continue' ? '' : flatten(state.doc, from, to).text;
      const before = tail(flatten(state.doc, Math.max(0, from - 8000), from).text, cmd === 'continue' ? 4000 : 1500);
      const id = ++jobIdRef.current;
      const tone = cmd === 'tone' ? (opts?.tone ?? 'darker') : undefined;
      const base = { id, cmd, tone, original: passage, result: '', showDiff: inlineCommand(cmd).corrective };
      setAnchor(place(from, to));

      const fail = (error: string) => {
        setAiTarget(editor, null);
        setJob({ ...base, status: 'error', error });
      };
      if (cmd === 'continue' ? !before.trim() : !passage.trim()) {
        return fail(cmd === 'continue' ? 'Write a few lines first: Continue picks up where your text ends.' : 'Put the cursor in a paragraph or select some text first.');
      }
      if (passage.length > MAX_CHARS) return fail('That is a lot for one command. Select up to about 2,500 words.');

      const h = hostRef.current;
      if (!h || (h.statusKnown && !h.ready)) {
        setAiTarget(editor, { from, to, running: false });
        setJob({ ...base, status: 'unavailable' });
        return;
      }
      setAiTarget(editor, { from, to, running: true });
      setJob({ ...base, status: 'running' });

      // Stream into the card, at most one render per frame.
      let latest = '';
      let frame = 0;
      const run = h.run(buildInlinePrompt(cmd, passage, before, tone), (text) => {
        latest = text;
        if (!frame) {
          frame = requestAnimationFrame(() => {
            frame = 0;
            const t = latest;
            setJob((j) => (j && j.id === id ? { ...j, result: t } : j));
          });
        }
      });
      runRef.current = run;
      void run.done.then((r) => {
        if (frame) cancelAnimationFrame(frame);
        if (jobIdRef.current !== id) return; // discarded or replaced meanwhile
        runRef.current = null;
        if (!editor.isDestroyed) {
          const t = getAiTarget(editor);
          if (t) setAiTarget(editor, { ...t, running: false });
        }
        const text = cleanInlineOutput(r.text, passage);
        if (r.error || !text) {
          const unavailable = r.error?.kind === 'auth' || r.error?.kind === 'unavailable';
          setJob((j) =>
            j && j.id === id
              ? { ...j, status: unavailable ? 'unavailable' : 'error', model: r.model, error: r.error?.message ?? 'The AI sent back nothing. Try again.' }
              : j,
          );
          return;
        }
        setJob((j) => (j && j.id === id ? { ...j, status: 'done', result: text, model: r.model } : j));
      });
    },
    [editor, place],
  );

  const discard = useCallback(() => {
    jobIdRef.current++;
    runRef.current?.cancel();
    runRef.current = null;
    setJob(null);
    if (editor && !editor.isDestroyed) {
      setAiTarget(editor, null);
      editor.commands.focus();
    }
  }, [editor]);

  const accept = useCallback(() => {
    if (!editor || editor.isDestroyed || !job || job.status !== 'done') return;
    const t = getAiTarget(editor);
    jobIdRef.current++;
    setAiTarget(editor, null);
    setJob(null);
    if (!t) return;
    if (job.cmd === 'continue') insertParagraphsAfter(editor, t.from, job.result);
    else if (job.result !== job.original) applyRewrite(editor, t.from, t.to, job.result, job.original, true);
    editor.commands.focus();
  }, [editor, job]);

  const retry = useCallback(
    (tone?: ToneId) => {
      if (!editor || !job) return;
      const t = getAiTarget(editor);
      start(job.cmd, { tone: tone ?? job.tone, range: t ? { from: t.from, to: t.to } : undefined });
    },
    [editor, job, start],
  );

  const openMenu = useCallback(
    (opts?: { tone?: boolean }) => {
      if (!editor) return;
      if (mobile) {
        // No floating menu on phones: "Change tone" starts right away; the card offers the other tones.
        if (opts?.tone) start('tone');
        return;
      }
      const { from, to, empty } = editor.state.selection;
      setBubble(null);
      setMenu({ anchor: place(from, to) ?? { left: 24, top: 96 }, tone: !!opts?.tone, index: 0, scope: empty ? 'paragraph' : 'selection' });
    },
    [editor, mobile, place, start],
  );

  // Expose the controller to the slash menu, Tools sheet and Format panel.
  useEffect(() => {
    if (!editor) return;
    return registerInlineAi(editor, { start: (c, o) => start(c, o), openMenu });
  }, [editor, start, openMenu]);

  // Stop a running request when the editor goes away.
  useEffect(() => () => runRef.current?.cancel(), []);

  // Desktop: a small ✦ button next to a selection.
  useEffect(() => {
    if (!editor || mobile) return;
    const onSel = () => {
      const { from, to, empty } = editor.state.selection;
      if (empty || !editor.isFocused || getAiTarget(editor) || editor.state.doc.textBetween(from, to, ' ').trim().length < 2) {
        setBubble(null);
        return;
      }
      try {
        const c = editor.view.coordsAtPos(to);
        setBubble({ left: Math.min(c.right + 6, window.innerWidth - 40), top: c.top - 4 });
      } catch {
        setBubble(null);
      }
    };
    const hide = () => setBubble(null);
    editor.on('selectionUpdate', onSel);
    editor.on('blur', hide);
    const el = scrollRef.current;
    el?.addEventListener('scroll', hide, { passive: true });
    return () => {
      editor.off('selectionUpdate', onSel);
      editor.off('blur', hide);
      el?.removeEventListener('scroll', hide);
    };
  }, [editor, mobile, scrollRef]);

  // Keep the card / menu attached to the text while the page scrolls or the window resizes.
  const hasJob = !!job;
  const hasMenu = !!menu;
  useEffect(() => {
    if (!editor || mobile || (!hasJob && !hasMenu)) return;
    const update = () => {
      const t = getAiTarget(editor);
      if (t) setAnchor(place(t.from, t.to));
      const { from, to } = editor.state.selection;
      setMenu((m) => (m ? { ...m, anchor: place(from, to) ?? m.anchor } : m));
    };
    const el = scrollRef.current;
    el?.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      el?.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [editor, mobile, hasJob, hasMenu, place, scrollRef]);

  // Phone: the card docks over the bottom of the page. Give the page room to scroll past it and
  // bring the passage into view above the card.
  useEffect(() => {
    const el = scrollRef.current;
    if (!mobile || !hasJob || !el || !editor) return;
    const prev = el.style.paddingBottom;
    el.style.paddingBottom = '55vh';
    const t = getAiTarget(editor);
    if (t) {
      try {
        const box = el.getBoundingClientRect();
        const at = editor.view.coordsAtPos(t.from);
        const visibleBottom = box.top + el.clientHeight * 0.4;
        if (at.top < box.top || at.top > visibleBottom) el.scrollTop += at.top - box.top - 24;
      } catch {
        /* position not measurable (hidden) */
      }
    }
    return () => {
      el.style.paddingBottom = prev;
    };
  }, [mobile, hasJob, editor, scrollRef]);

  // Card keys: Esc discards, Ctrl/⌘+Enter accepts.
  useEffect(() => {
    if (!job) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        discard();
      } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && job.status === 'done') {
        e.preventDefault();
        e.stopPropagation();
        accept();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [job, accept, discard]);

  // Menu keys + click-outside.
  const menuItems = useMemo(
    () =>
      menu?.tone
        ? TONES.map((t) => ({ key: t.id, label: t.label, description: '', run: () => start('tone', { tone: t.id }) }))
        : INLINE_COMMANDS.map((c) => ({
            key: c.id,
            label: c.label,
            description: c.description,
            run: () => (c.id === 'tone' ? setMenu((m) => (m ? { ...m, tone: true, index: 0 } : m)) : start(c.id)),
          })),
    [menu?.tone, start],
  );
  useEffect(() => {
    if (!hasMenu) return;
    const onKey = (e: KeyboardEvent) => {
      const keys = ['ArrowDown', 'ArrowUp', 'Enter', 'Escape', 'ArrowLeft', 'ArrowRight'];
      if (!keys.includes(e.key)) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') setMenu(null);
      else if (e.key === 'ArrowDown') setMenu((m) => m && { ...m, index: (m.index + 1) % menuItems.length });
      else if (e.key === 'ArrowUp') setMenu((m) => m && { ...m, index: (m.index - 1 + menuItems.length) % menuItems.length });
      else if (e.key === 'ArrowLeft') setMenu((m) => m && { ...m, tone: false, index: 0 });
      else {
        const m = menuNowRef.current;
        if (m) menuItems[m.index]?.run();
      }
    };
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(null);
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('mousedown', onDown);
    };
  }, [hasMenu, menuItems]);

  const fixed = (a: Anchor | null, width: number): CSSProperties =>
    a ? { position: 'fixed', left: a.left, top: a.top, bottom: a.bottom, width, zIndex: 60 } : { position: 'fixed', left: 24, top: 96, width, zIndex: 60 };

  return (
    <>
      {bubble && !job && !menu && (
        <button
          type="button"
          className="mn-ai-bubble"
          style={{ position: 'fixed', left: bubble.left, top: bubble.top - 22, zIndex: 55 }}
          title="AI commands (Ctrl+J)"
          aria-label="AI commands"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => openMenu()}
        >
          <Sparkles className="w-3.5 h-3.5" />
        </button>
      )}

      {menu && (
        <div ref={menuRef} className="slash-menu" role="menu" aria-label="AI commands" style={fixed(menu.anchor, 256)} onMouseDown={(e) => e.preventDefault()}>
          <div className="flex items-center gap-1.5 px-2.5 pt-1 pb-1.5 text-3xs font-medium uppercase tracking-wider text-muted-foreground/70">
            {menu.tone ? (
              <button className="inline-flex items-center gap-1 hover:text-foreground cursor-pointer" onClick={() => setMenu({ ...menu, tone: false, index: 0 })}>
                <ArrowLeft className="w-3 h-3" /> Tone
              </button>
            ) : (
              <>
                <Sparkles className="w-3 h-3 text-primary" /> AI · {menu.scope === 'selection' ? 'Selection' : 'This paragraph'}
              </>
            )}
          </div>
          {menuItems.map((item, i) => {
            const active = i === menu.index;
            const Icon = menu.tone ? INLINE_ICONS.tone : INLINE_ICONS[item.key as InlineCommandId];
            return (
              <button
                key={item.key}
                type="button"
                role="menuitem"
                onMouseEnter={() => setMenu({ ...menu, index: i })}
                onClick={item.run}
                className={`flex items-center gap-3 w-full text-left px-2.5 py-1.5 rounded-md cursor-pointer transition-colors ${
                  active ? 'bg-primary text-primary-foreground' : 'text-foreground/90 hover:bg-secondary/50'
                }`}
              >
                <span className={`w-7 h-7 flex items-center justify-center rounded-md border ${active ? 'border-primary-foreground/30 bg-primary-foreground/10' : 'border-border/40 bg-secondary/40'}`}>
                  <Icon className="w-4 h-4" />
                </span>
                <span className="flex flex-col leading-tight min-w-0 flex-1">
                  <span className="text-sm font-medium">{item.label}</span>
                  {item.description && (
                    <span className={`text-[11px] ${active ? 'text-primary-foreground/75' : 'text-muted-foreground/70'}`}>{item.description}</span>
                  )}
                </span>
                {item.key === 'tone' && !menu.tone && <ChevronRight className="w-3.5 h-3.5 opacity-60" />}
              </button>
            );
          })}
        </div>
      )}

      {job && (
        <InlineCard
          job={job}
          mobile={mobile}
          style={mobile ? undefined : fixed(anchor, Math.min(CARD_W, typeof window !== 'undefined' ? window.innerWidth - 16 : CARD_W))}
          modelLabel={host?.modelLabel}
          onAccept={accept}
          onDiscard={discard}
          onRetry={retry}
          onToggleDiff={() => setJob({ ...job, showDiff: !job.showDiff })}
          onConnect={() => {
            discard();
            host?.openConnect();
          }}
        />
      )}
    </>
  );
}

interface CardProps {
  job: Job;
  mobile: boolean;
  style?: CSSProperties;
  modelLabel?: string;
  onAccept: () => void;
  onDiscard: () => void;
  onRetry: (tone?: ToneId) => void;
  onToggleDiff: () => void;
  onConnect: () => void;
}

function InlineCard({ job, mobile, style, modelLabel, onAccept, onDiscard, onRetry, onToggleDiff, onConnect }: CardProps) {
  const cmd = inlineCommand(job.cmd);
  const Icon = INLINE_ICONS[job.cmd];
  const unchanged = job.status === 'done' && job.cmd !== 'continue' && job.result === job.original;
  const btn = `${mobile ? 'h-9 px-3 text-sm' : 'h-7 px-2.5 text-xs'} inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg font-medium transition-colors cursor-pointer`;
  const ghost = `${btn} text-muted-foreground hover:text-foreground hover:bg-secondary/60`;
  const toneLabel = TONES.find((t) => t.id === job.tone)?.label;

  return (
    <div
      role="dialog"
      aria-label={`AI ${cmd.label}`}
      style={style}
      className={`mn-ai-card flex flex-col overflow-hidden rounded-xl border border-border/50 bg-popover text-popover-foreground shadow-2xl ${
        mobile ? 'absolute left-2 right-2 bottom-2 z-30 max-h-[55%]' : 'max-h-[min(60vh,440px)]'
      }`}
      onMouseDown={(e) => e.preventDefault()}
    >
      <div className="flex items-center gap-2 px-3 h-9 shrink-0 border-b border-border/30">
        <Icon className="w-3.5 h-3.5 text-primary shrink-0" />
        <span className="text-xs font-medium text-foreground truncate">
          {cmd.label}
          {toneLabel && <span className="text-muted-foreground"> · {toneLabel}</span>}
        </span>
        {(job.model || modelLabel) && <span className="text-3xs text-muted-foreground/70 truncate">{job.model ? prettyModel(job.model) : modelLabel}</span>}
        <button className="ml-auto w-6 h-6 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary/60 cursor-pointer" onClick={onDiscard} title="Discard (Esc)" aria-label="Discard">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {job.cmd === 'tone' && job.status !== 'unavailable' && (
        <div className="flex gap-1.5 px-3 pt-2 overflow-x-auto shrink-0">
          {TONES.map((t) => (
            <button
              key={t.id}
              className={`shrink-0 rounded-full border px-2.5 ${mobile ? 'py-1 text-xs' : 'py-0.5 text-3xs'} font-medium cursor-pointer transition-colors ${
                t.id === job.tone ? 'border-primary/40 bg-primary/12 text-primary' : 'border-border/50 text-muted-foreground hover:text-foreground'
              }`}
              onClick={() => t.id !== job.tone && onRetry(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      <div className={`px-3 py-2.5 overflow-y-auto overscroll-contain min-h-0 ${mobile ? 'text-[15px]' : 'text-sm'} leading-relaxed`}>
        {job.status === 'running' && !job.result && (
          <p className="flex items-center gap-2 text-muted-foreground" role="status">
            <span className="mn-ai-dot" /> {cmd.progress}…
          </p>
        )}
        {job.status === 'running' && job.result && <p className="whitespace-pre-wrap break-words text-foreground/85">{job.result}</p>}
        {job.status === 'done' &&
          (unchanged ? (
            <p className="text-muted-foreground">Looks good: nothing to change.</p>
          ) : job.cmd === 'continue' ? (
            <p className="whitespace-pre-wrap break-words border-l-2 border-emerald-500/60 pl-2.5 text-foreground/90">{job.result}</p>
          ) : job.showDiff ? (
            <Diff before={job.original} after={job.result} />
          ) : (
            <p className="whitespace-pre-wrap break-words text-foreground/90">{job.result}</p>
          ))}
        {job.status === 'error' && <p className="text-destructive/90 break-words">{job.error}</p>}
        {job.status === 'unavailable' && (
          <div className="flex flex-col gap-2 items-start">
            <p className="text-muted-foreground">{job.error ?? 'Connect an AI to use inline commands.'}</p>
            <button className={`${btn} bg-primary text-primary-foreground hover:bg-primary/90`} onClick={onConnect}>
              <KeyRound className="w-3.5 h-3.5" /> Connect an AI
            </button>
          </div>
        )}
      </div>

      {job.status !== 'unavailable' && (
        <div className="flex items-center gap-1.5 px-3 py-2 shrink-0 border-t border-border/30">
          {job.status === 'done' && !unchanged && job.cmd !== 'continue' && (
            <button className={ghost} onClick={onToggleDiff}>
              {mobile ? (job.showDiff ? 'Result' : 'Changes') : job.showDiff ? 'Show result' : 'Show changes'}
            </button>
          )}
          <div className="ml-auto flex items-center gap-1.5">
            {job.status === 'running' ? (
              <button className={ghost} onClick={onDiscard}>
                Stop
              </button>
            ) : (
              <>
                {!unchanged && (
                  <button className={ghost} onClick={onDiscard}>
                    Discard
                  </button>
                )}
                {(job.status === 'done' || job.status === 'error') && (
                  <button className={ghost} onClick={() => onRetry()} title="Try again">
                    <RotateCcw className="w-3.5 h-3.5" /> Retry
                  </button>
                )}
                {job.status === 'done' &&
                  (unchanged ? (
                    <button className={`${btn} bg-secondary text-foreground hover:bg-secondary/80`} onClick={onDiscard}>
                      Close
                    </button>
                  ) : (
                    <button className={`${btn} bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm`} onClick={onAccept} title="Accept (Ctrl+Enter)">
                      <Check className="w-3.5 h-3.5" /> {job.cmd === 'continue' ? 'Insert' : 'Accept'}
                    </button>
                  ))}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Diff({ before, after }: { before: string; after: string }) {
  const ops = useMemo(() => wordDiff(before, after), [before, after]);
  return (
    <p className="whitespace-pre-wrap break-words text-foreground/80">
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
    </p>
  );
}
