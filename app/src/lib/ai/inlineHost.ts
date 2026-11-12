import { runInlineTurn, type InlineResult } from './client';
import type { InlinePrompt } from './inline';
import { modelLabel, type AiProviderInfo } from './providers';
import type { ProjectAiConfig } from './types';

/** What the editor needs to run an inline command (/polish …) with the project's AI. */
export interface InlineAiHost {
  ready: boolean;
  /** False until the key / CLI status has loaded. */
  statusKnown: boolean;
  /** "Opus", "Claude Opus 5.5"… for the card header. */
  modelLabel: string;
  run(prompt: InlinePrompt, onText: (text: string) => void): { done: Promise<InlineResult>; cancel: () => void };
  /** Show where to connect an AI (desktop: the AI panel; phone: the AI tab). */
  openConnect(): void;
}

interface ChatLike {
  config: ProjectAiConfig;
  provider: AiProviderInfo;
  ready: boolean;
  statusKnown: boolean;
}

/** The editor's handle on the project's AI. Inline runs are not part of any chat session. */
export function inlineHostFor(chat: ChatLike, openConnect: () => void): InlineAiHost {
  const { config, provider } = chat;
  return {
    ready: chat.ready,
    statusKnown: chat.statusKnown,
    modelLabel: config.model ? (provider.models.find((m) => m.id === config.model)?.label ?? modelLabel(config.model)) : provider.label,
    run: (prompt, onText) => runInlineTurn({ provider: config.provider, model: config.model, prompt, onText }),
    openConnect,
  };
}
