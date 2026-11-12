import type { ReactNode } from 'react';
import type { Document, Project } from '../../types';
import type { ProjectAiConfig } from '../../lib/ai/types';
import { useAiChat, type AiChat } from '../../lib/ai/useAiChat';

interface Props {
  project: Project;
  documents: Document[];
  activeDocument: Document | null;
  isMobile: boolean;
  onConfigChange: (config: ProjectAiConfig) => void;
  children: (chat: AiChat) => ReactNode;
}

/**
 * Owns the AI chat state for the open project and hands it to the shell's layout. It lives above
 * the panel/screen, so closing the AI panel (or leaving the AI tab) doesn't stop a running reply.
 * App mounts it with `key={project.id}`: a different project always starts with fresh state.
 */
export default function AiScope({ children, ...opts }: Props) {
  const chat = useAiChat(opts);
  return <>{children(chat)}</>;
}
