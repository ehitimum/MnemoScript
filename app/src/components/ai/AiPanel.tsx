import { History, MessageSquarePlus, PlugZap, Sparkles, X } from 'lucide-react';
import type { Document } from '../../types';
import type { AiChat } from '../../lib/ai/useAiChat';
import AiChatBody from './AiChatBody';

interface Props {
  chat: AiChat;
  documents: Document[];
  projectName: string;
  onClose: () => void;
}

/** Desktop right-hand AI panel. Same chrome as the Format panel (RightSidebar). */
export default function AiPanel({ chat, documents, projectName, onClose }: Props) {
  const iconBtn = (active = false) =>
    `w-7 h-7 flex items-center justify-center rounded-md transition-all cursor-pointer disabled:opacity-35 disabled:pointer-events-none ${
      active ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground'
    }`;
  const title = chat.view === 'sessions' ? 'Sessions' : chat.view === 'connect' ? 'Connect' : chat.session?.title;

  return (
    <aside className="w-[360px] max-w-[90vw] shrink-0 h-full bg-sidebar border-l border-border/40 flex flex-col min-h-0" aria-label="AI assistant">
      <div className="h-10 shrink-0 flex items-center gap-2 pl-4 pr-2 border-b border-border/30 select-none">
        <Sparkles className="w-3.5 h-3.5 text-primary shrink-0" />
        <span className="text-3xs font-semibold tracking-[0.14em] text-muted-foreground uppercase shrink-0">AI</span>
        {title && <span className="text-xs text-foreground/75 truncate min-w-0">{title}</span>}
        <div className="flex-1" />
        <button
          className={iconBtn(chat.view === 'sessions')}
          onClick={() => chat.setView(chat.view === 'sessions' ? 'chat' : 'sessions')}
          title="Sessions in this project"
        >
          <History className="w-3.5 h-3.5" />
        </button>
        <button className={iconBtn()} onClick={chat.startNew} disabled={chat.busy} title="New session">
          <MessageSquarePlus className="w-3.5 h-3.5" />
        </button>
        <button
          className={iconBtn(chat.view === 'connect')}
          onClick={() => chat.setView(chat.view === 'connect' ? 'chat' : 'connect')}
          title="AI connection"
        >
          <PlugZap className="w-3.5 h-3.5" />
        </button>
        <button className={iconBtn()} onClick={onClose} title="Close (Ctrl+L)">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="flex-1 min-h-0 flex flex-col">
        <AiChatBody chat={chat} documents={documents} projectName={projectName} size="sm" isMobile={false} />
      </div>
    </aside>
  );
}
