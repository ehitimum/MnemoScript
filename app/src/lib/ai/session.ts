import type { AiChange, AiEvent, AiMessage, AiMode, AiProviderId, AiSession } from './types';

/** Pure session helpers (no I/O), so the chat UI and tests share one source of truth. */

export function uid(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

const now = () => new Date().toISOString();

export function newSession(provider: AiProviderId): AiSession {
  const t = now();
  return { version: 1, id: uid(), title: 'New session', provider, models: [], createdAt: t, updatedAt: t, messages: [] };
}

function titleFrom(text: string): string {
  const one = text.replace(/\s+/g, ' ').trim();
  return one.length > 60 ? `${one.slice(0, 57).trimEnd()}…` : one || 'New session';
}

export function addUserMessage(session: AiSession, text: string): AiSession {
  const msg: AiMessage = { id: uid(), role: 'user', text, createdAt: now() };
  const first = !session.messages.some((m) => m.role === 'user');
  return {
    ...session,
    title: first ? titleFrom(text) : session.title,
    messages: [...session.messages, msg],
    updatedAt: msg.createdAt,
  };
}

export function startAssistantMessage(provider: AiProviderId, model: string, mode: AiMode): AiMessage {
  return { id: uid(), role: 'assistant', text: '', createdAt: now(), provider, model: model || undefined, mode, pending: true };
}

/** Apply one streamed event to the reply being built. */
export function applyEvent(msg: AiMessage, ev: AiEvent): AiMessage {
  switch (ev.type) {
    case 'started':
      return { ...msg, model: ev.model };
    case 'textDelta':
      return { ...msg, text: msg.text + ev.text };
    case 'toolCall':
      return { ...msg, toolCalls: [...(msg.toolCalls ?? []), { callId: ev.callId, name: ev.name, input: ev.input }] };
    case 'usage':
      return { ...msg, usage: { inputTokens: ev.inputTokens, outputTokens: ev.outputTokens, costUsd: ev.costUsd } };
    case 'done':
      return { ...msg, pending: false };
    case 'error':
      return { ...msg, pending: false, error: { kind: ev.kind, message: ev.message } };
    default:
      return msg;
  }
}

export function recordToolResult(msg: AiMessage, callId: string, result: string, isError: boolean, change?: AiChange): AiMessage {
  return {
    ...msg,
    toolCalls: (msg.toolCalls ?? []).map((c) =>
      c.callId === callId ? { ...c, result, isError, ...(change ? { change } : {}) } : c,
    ),
  };
}

/** Ask mode: show the proposal on its tool call while the writer decides. */
export function recordProposal(msg: AiMessage, callId: string, change: AiChange): AiMessage {
  return { ...msg, toolCalls: (msg.toolCalls ?? []).map((c) => (c.callId === callId ? { ...c, change } : c)) };
}

/** Update one change card after the turn (undo). */
export function patchChange(session: AiSession, messageId: string, callId: string, patch: Partial<AiChange>): AiSession {
  return {
    ...session,
    updatedAt: now(),
    messages: session.messages.map((m) =>
      m.id !== messageId
        ? m
        : {
            ...m,
            toolCalls: (m.toolCalls ?? []).map((c) =>
              c.callId === callId && c.change ? { ...c, change: { ...c.change, ...patch } } : c,
            ),
          },
    ),
  };
}

/** Put the (finished or in-progress) reply into the session and refresh its model list. */
export function withAssistantMessage(session: AiSession, msg: AiMessage): AiSession {
  const exists = session.messages.some((m) => m.id === msg.id);
  const messages = exists ? session.messages.map((m) => (m.id === msg.id ? msg : m)) : [...session.messages, msg];
  const models = msg.model && !msg.pending ? [msg.model, ...session.models.filter((m) => m !== msg.model)] : session.models;
  return { ...session, messages, models, provider: msg.provider ?? session.provider, updatedAt: now() };
}

/** Never persist a half-streamed reply as still running (e.g. the app closed mid-turn). */
export function forStorage(session: AiSession): AiSession {
  return {
    ...session,
    messages: session.messages.map((m) => {
      const settled = m.toolCalls?.some((c) => c.change?.status === 'pending')
        ? {
            ...m,
            toolCalls: m.toolCalls!.map((c) =>
              c.change?.status === 'pending' ? { ...c, change: { ...c.change, status: 'rejected' as const } } : c,
            ),
          }
        : m;
      return settled.pending
        ? { ...settled, pending: false, error: settled.error ?? { kind: 'cancelled', message: 'Interrupted' } }
        : settled;
    }),
  };
}
