import { useEffect, type ReactNode } from 'react';
import type { Document, Project } from '../../types';
import type { ProjectAiConfig } from '../../lib/ai/types';
import { useAiChat, type AiChat, type AiDocumentBridge } from '../../lib/ai/useAiChat';

interface Props {
  project: Project;
  documents: Document[];
  activeDocument: Document | null;
  isMobile: boolean;
  onConfigChange: (config: ProjectAiConfig) => void;
  bridge?: AiDocumentBridge;
  /** Told when a proposal starts / stops waiting for the writer (badges the AI button). */
  onAttentionChange?: (waiting: boolean) => void;
  children: (chat: AiChat) => ReactNode;
}

/**
 * Owns the AI chat state for the open project and hands it to the shell's layout. It lives above
 * the panel/screen, so closing the AI panel (or leaving the AI tab) doesn't stop a running reply.
 * App mounts it with `key={project.id}`: a different project always starts with fresh state.
 */
export default function AiScope({ children, onAttentionChange, ...opts }: Props) {
  const chat = useAiChat(opts);
  const waiting = chat.awaitingApproval;
  useEffect(() => {
    onAttentionChange?.(waiting);
  }, [waiting, onAttentionChange]);
  useEffect(() => () => onAttentionChange?.(false), [onAttentionChange]);
  return <>{children(chat)}</>;
}
