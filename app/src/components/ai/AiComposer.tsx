import { useState } from 'react';
import { ArrowUp, AtSign, Check, ChevronDown, ClipboardList, Hand, Square, Zap } from 'lucide-react';
import type { AiChat } from '../../lib/ai/useAiChat';
import type { AiMode } from '../../lib/ai/types';
import { modelLabel } from '../../lib/ai/providers';
import { resetsIn } from '../../lib/ai/format';
import BottomSheet from '../mobile/BottomSheet';
import ModelBadge from './ModelBadge';

type Size = 'sm' | 'lg';

const MODES: { id: AiMode; label: string; hint: string; Icon: typeof Hand }[] = [
  { id: 'plan', label: 'Plan', hint: 'Reads only and suggests a plan', Icon: ClipboardList },
  { id: 'ask', label: 'Ask', hint: 'Asks before changing anything', Icon: Hand },
  { id: 'auto', label: 'Auto', hint: 'Applies changes (you can undo)', Icon: Zap },
];

interface Props {
  chat: AiChat;
  size: Size;
  /** Phone shell hides its tab bar while the keyboard is up. */
  onFocusChange?: (focused: boolean) => void;
}

/** Message box + mode switch + model picker. Shared by the desktop panel and the phone screen. */
export default function AiComposer({ chat, size, onFocusChange }: Props) {
  const [text, setText] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const lg = size === 'lg';

  const submit = () => {
    if (!text.trim() || chat.busy || !chat.ready) return;
    chat.send(text);
    setText('');
  };

  const currentModel = chat.provider.models.find((m) => m.id === chat.config.model);
  const modelName = currentModel?.label ?? (chat.config.model ? modelLabel(chat.config.model) : 'Default');
  const limitWarn = chat.rateLimit && chat.rateLimit.status !== 'allowed';

  return (
    <div className={`shrink-0 flex flex-col gap-2 ${lg ? 'px-3 pt-2 pb-3' : 'px-3 pt-2 pb-3'} border-t border-border/30 bg-sidebar/60`}>
      {limitWarn && (
        <div className="text-3xs text-amber-500/90 px-1">
          {chat.rateLimit!.utilization != null ? `${Math.round(chat.rateLimit!.utilization * 100)}% of your ${windowName(chat.rateLimit!.window)} used` : `Close to your ${windowName(chat.rateLimit!.window)}`}
          {chat.rateLimit!.resetsAt ? ` · ${resetsIn(chat.rateLimit!.resetsAt)}` : ''}
        </div>
      )}

      <div className={`flex flex-col rounded-2xl border bg-background/70 transition-colors ${chat.ready ? 'border-border/50 focus-within:border-primary/50' : 'border-border/30 opacity-70'}`}>
        {chat.activeDocument && (
          <div className="flex items-center gap-1 px-3 pt-2 text-3xs text-muted-foreground/80 min-w-0">
            <AtSign className="w-3 h-3 shrink-0 text-primary/70" />
            <span className="truncate">{chat.activeDocument.title}</span>
          </div>
        )}
        <textarea
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            const el = e.target;
            el.style.height = 'auto';
            el.style.height = `${Math.min(el.scrollHeight, lg ? 132 : 160)}px`;
          }}
          onKeyDown={(e) => {
            // Desktop: Enter sends, Shift+Enter breaks the line. Phones: the return key adds a line.
            if (!lg && e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          onFocus={() => onFocusChange?.(true)}
          onBlur={() => onFocusChange?.(false)}
          disabled={!chat.ready}
          rows={1}
          placeholder={chat.ready ? (chat.session ? 'Reply…' : 'Ask about your story…') : 'Connect an AI to start'}
          className={`w-full resize-none bg-transparent outline-none px-3 py-2.5 text-foreground placeholder:text-muted-foreground/60 ${lg ? 'text-[16px] min-h-[44px]' : 'text-sm min-h-[40px]'}`}
        />
        <div className="flex items-center gap-1.5 px-2 pb-2">
          <ModeSwitch chat={chat} size={size} />
          <div className="relative min-w-0">
            <button
              onClick={() => setPickerOpen((o) => !o)}
              className={`flex items-center gap-1.5 rounded-lg px-2 text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-all cursor-pointer min-w-0 ${lg ? 'h-9 text-xs' : 'h-7 text-3xs'}`}
              title="Choose model"
            >
              <ModelBadge vendor={chat.provider.vendor} size="xs" />
              <span className="truncate max-w-[12ch]">{modelName}</span>
              <ChevronDown className="w-3 h-3 shrink-0" />
            </button>
            {pickerOpen && !lg && <ModelPopover chat={chat} onClose={() => setPickerOpen(false)} />}
          </div>
          <div className="flex-1" />
          {chat.busy ? (
            <button
              onClick={chat.stop}
              className={`${lg ? 'w-10 h-10' : 'w-8 h-8'} rounded-full flex items-center justify-center bg-foreground/85 text-background active:scale-90 transition-all cursor-pointer`}
              title="Stop"
            >
              <Square className="w-3.5 h-3.5 fill-current" />
            </button>
          ) : (
            <button
              onClick={submit}
              disabled={!text.trim() || !chat.ready}
              className={`${lg ? 'w-10 h-10' : 'w-8 h-8'} rounded-full flex items-center justify-center bg-primary text-primary-foreground active:scale-90 transition-all cursor-pointer disabled:opacity-30 disabled:pointer-events-none`}
              title="Send (Enter)"
            >
              <ArrowUp className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {pickerOpen && lg && (
        <BottomSheet title="Model" onClose={() => setPickerOpen(false)}>
          <ModelOptions chat={chat} lg onPicked={() => setPickerOpen(false)} />
        </BottomSheet>
      )}
    </div>
  );
}

function windowName(w: string): string {
  if (w === 'five_hour') return '5-hour limit';
  if (w.startsWith('seven_day')) return 'weekly limit';
  return 'usage limit';
}

function ModeSwitch({ chat, size }: { chat: AiChat; size: Size }) {
  const lg = size === 'lg';
  return (
    <div className="flex items-center rounded-lg bg-secondary/50 p-0.5" role="radiogroup" aria-label="Mode">
      {MODES.map(({ id, label, hint, Icon }) => {
        const active = chat.config.mode === id;
        return (
          <button
            key={id}
            role="radio"
            aria-checked={active}
            onClick={() => chat.setMode(id)}
            title={`${label} — ${hint}`}
            className={`flex items-center gap-1 rounded-md font-medium transition-all cursor-pointer ${lg ? 'h-8 px-2.5 text-xs' : 'h-6 px-2 text-3xs'} ${
              active ? 'bg-background text-primary shadow-sm' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Icon className={lg ? 'w-3.5 h-3.5' : 'w-3 h-3'} />
            {/* Phones: only the active mode is labelled, so the row fits a 360px screen. */}
            {(!lg || active) && label}
          </button>
        );
      })}
    </div>
  );
}

function ModelPopover({ chat, onClose }: { chat: AiChat; onClose: () => void }) {
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="absolute bottom-full left-0 mb-2 z-50 w-60 rounded-xl border border-border/50 bg-popover shadow-2xl p-1.5 animate-in fade-in zoom-in-95 duration-100">
        <ModelOptions chat={chat} onPicked={onClose} />
      </div>
    </>
  );
}

/** Models of the connected provider + a free-form id where the vendor ships new models often. */
function ModelOptions({ chat, lg = false, onPicked }: { chat: AiChat; lg?: boolean; onPicked: () => void }) {
  const [custom, setCustom] = useState('');
  const isListed = chat.provider.models.some((m) => m.id === chat.config.model);
  return (
    <div className="flex flex-col gap-1">
      <div className={`px-2 pt-1 pb-1.5 text-3xs font-semibold tracking-[0.12em] uppercase text-muted-foreground/70`}>{chat.provider.label}</div>
      {chat.provider.models.map((m) => {
        const active = m.id === chat.config.model;
        return (
          <button
            key={m.id || 'default'}
            onClick={() => {
              chat.setModel(m.id);
              onPicked();
            }}
            className={lg ? `mn-row justify-between ${active ? 'border-primary' : ''}` : `flex items-center gap-2 w-full text-left rounded-lg px-2 py-1.5 hover:bg-secondary/60 cursor-pointer ${active ? 'text-primary' : 'text-foreground/90'}`}
          >
            <span className="flex flex-col min-w-0">
              <span className={lg ? 'text-sm' : 'text-xs font-medium'}>{m.label}</span>
              {m.hint && <span className="text-3xs text-muted-foreground/70">{m.hint}</span>}
            </span>
            {active && <Check className="w-3.5 h-3.5 shrink-0 ml-auto" />}
          </button>
        );
      })}
      {chat.provider.customModels && (
        <form
          className="flex items-center gap-1.5 px-1 pt-1"
          onSubmit={(e) => {
            e.preventDefault();
            if (!custom.trim()) return;
            chat.setModel(custom.trim());
            onPicked();
          }}
        >
          <input
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            placeholder={!isListed && chat.config.model ? chat.config.model : 'Other model id'}
            className={`flex-1 min-w-0 bg-secondary/40 border border-border/40 rounded-lg px-2 outline-none focus:border-primary/50 ${lg ? 'h-11 text-sm' : 'h-7 text-xs'}`}
          />
          <button type="submit" className={`rounded-lg bg-secondary/70 px-2 text-foreground/80 hover:text-foreground cursor-pointer ${lg ? 'h-11 text-sm' : 'h-7 text-xs'}`}>Use</button>
        </form>
      )}
      <button
        onClick={() => {
          chat.setView('connect');
          onPicked();
        }}
        className={`mt-1 text-left text-primary hover:underline cursor-pointer px-2 ${lg ? 'py-2 text-sm' : 'py-1 text-3xs'}`}
      >
        Change AI provider…
      </button>
    </div>
  );
}
