import type { Document } from '../../types';
import type { AiChat } from '../../lib/ai/useAiChat';
import AiComposer from './AiComposer';
import AiConnect from './AiConnect';
import AiMessages from './AiMessages';
import AiSessions from './AiSessions';

interface Props {
  chat: AiChat;
  documents: Document[];
  projectName: string;
  size: 'sm' | 'lg';
  isMobile: boolean;
  onComposerFocus?: (focused: boolean) => void;
}

/** The body shared by both shells: connect screen, session list, or transcript + composer. */
export default function AiChatBody({ chat, documents, projectName, size, isMobile, onComposerFocus }: Props) {
  const needsSetup = chat.statusKnown && !chat.ready && !chat.session;
  if (chat.view === 'connect' || (chat.view === 'chat' && needsSetup)) {
    return <AiConnect chat={chat} size={size} isMobile={isMobile} />;
  }
  if (chat.view === 'sessions') {
    return <AiSessions chat={chat} size={size} projectName={projectName} />;
  }
  return (
    <>
      <AiMessages chat={chat} documents={documents} size={size} />
      <AiComposer chat={chat} size={size} onFocusChange={onComposerFocus} />
    </>
  );
}
