import { ArrowLeft, History, PlugZap, SquarePen } from 'lucide-react';
import type { Document } from '../../types';
import type { AiChat } from '../../lib/ai/useAiChat';
import { useKeyboardInset } from '../../lib/useKeyboardInset';
import MobileTopBar from '../mobile/MobileTopBar';
import AiChatBody from './AiChatBody';

interface Props {
  chat: AiChat;
  documents: Document[];
  projectName: string;
  /** The shell hides its tab bar while the composer has focus (keyboard up). */
  onComposerFocus: (focused: boolean) => void;
}

/**
 * Phone AI screen (the "AI" tab). Full-height column: top bar → transcript (scrolls) → composer.
 * Nothing floats over the transcript, so open sheets/keyboards can't overlap it: the composer is
 * in the flow and is lifted by the keyboard inset when the WebView doesn't resize.
 */
export default function MobileAiScreen({ chat, documents, projectName, onComposerFocus }: Props) {
  const keyboard = useKeyboardInset();
  const btn = 'w-9 h-9 flex items-center justify-center rounded-xl text-foreground/80 active:scale-90 disabled:opacity-35';
  const inChat = chat.view === 'chat';

  return (
    <div className="flex-1 flex flex-col min-h-0" style={keyboard ? { paddingBottom: keyboard } : undefined}>
      <MobileTopBar
        title={chat.view === 'sessions' ? 'Sessions' : chat.view === 'connect' ? 'Connect an AI' : chat.session?.title ?? 'AI assistant'}
        subtitle={projectName}
        left={
          inChat ? (
            <button className={btn} onClick={() => chat.setView('sessions')} title="Sessions">
              <History className="w-5 h-5" />
            </button>
          ) : (
            <button className={btn} onClick={() => chat.setView('chat')} title="Back">
              <ArrowLeft className="w-5 h-5" />
            </button>
          )
        }
        right={
          inChat ? (
            <button className={btn} onClick={chat.startNew} disabled={chat.busy || !chat.session} title="New session">
              <SquarePen className="w-5 h-5" />
            </button>
          ) : chat.view === 'sessions' ? (
            <button className={btn} onClick={() => chat.setView('connect')} title="AI connection">
              <PlugZap className="w-5 h-5" />
            </button>
          ) : undefined
        }
      />
      <div className="flex-1 min-h-0 flex flex-col">
        <AiChatBody chat={chat} documents={documents} projectName={projectName} size="lg" isMobile onComposerFocus={onComposerFocus} />
      </div>
    </div>
  );
}
