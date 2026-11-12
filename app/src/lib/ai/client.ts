import { api } from '../api';
import { buildTurnRequest, type TurnContext } from './context';
import { addUserMessage, applyEvent, recordProposal, recordToolResult, startAssistantMessage, uid, withAssistantMessage } from './session';
import { executeTool, type ProjectAccess } from './tools';
import type { AiEvent, AiSession, AiTurnRequest } from './types';

/** Backend surface the turn runner needs (the real one is `api`; tests inject a fake). */
export interface AiTransport {
  startTurn(req: AiTurnRequest, onEvent: (e: AiEvent) => void): Promise<void>;
  toolResult(turnId: string, callId: string, content: string, isError: boolean): Promise<void>;
  cancelTurn(turnId: string): Promise<boolean>;
}

export const defaultTransport: AiTransport = {
  startTurn: (req, onEvent) => api.aiStartTurn(req, onEvent),
  toolResult: (t, c, content, isError) => api.aiToolResult(t, c, content, isError),
  cancelTurn: (t) => api.aiCancelTurn(t),
};

export interface RunTurnOptions extends Omit<TurnContext, 'turnId'> {
  session: AiSession;
  userText: string;
  access: ProjectAccess;
  transport?: AiTransport;
  /** Called on every change (new text, tool call…) with the updated session. */
  onUpdate?: (session: AiSession) => void;
  /** Rate-limit info for the usage bars (Claude Code). */
  onRateLimit?: (e: Extract<AiEvent, { type: 'rateLimit' }>) => void;
}

export interface RunningTurn {
  turnId: string;
  /** Resolves with the final session (also after an error — the error is on the reply). */
  done: Promise<AiSession>;
  cancel: () => void;
}

/**
 * Run one chat turn: add the writer's message, stream the reply, execute tool calls here (where
 * the documents are) and hand results back to the backend. Persisting is the caller's job.
 */
export function runTurn(opts: RunTurnOptions): RunningTurn {
  const transport = opts.transport ?? defaultTransport;
  const turnId = uid();
  const base = addUserMessage(opts.session, opts.userText);
  const request = buildTurnRequest(base, { ...opts, turnId });
  let reply = startAssistantMessage(opts.provider, opts.model, opts.mode);
  let session = withAssistantMessage(base, reply);
  opts.onUpdate?.(session);

  let settled = false;
  const update = (next: typeof reply) => {
    if (settled) return; // e.g. a proposal rejected after the turn was stopped
    reply = next;
    session = withAssistantMessage(session, reply);
    opts.onUpdate?.(session);
  };

  const done = new Promise<AiSession>((resolve) => {
    const finish = () => {
      if (!settled) {
        settled = true;
        resolve(session);
      }
    };
    const onEvent = (ev: AiEvent) => {
      if (settled) return;
      if (ev.type === 'rateLimit') {
        opts.onRateLimit?.(ev);
        return;
      }
      update(applyEvent(reply, ev));
      if (ev.type === 'toolCall') {
        void (async () => {
          const r = await executeTool(ev.name, ev.input, opts.access, opts.mode, {
            callId: ev.callId,
            onProposal: (change) => update(recordProposal(reply, ev.callId, change)),
          }).catch((e: unknown) => ({
            content: `Tool failed: ${e instanceof Error ? e.message : String(e)}`,
            isError: true,
            change: undefined,
          }));
          update(recordToolResult(reply, ev.callId, r.content, r.isError, r.change));
          await transport.toolResult(turnId, ev.callId, r.content, r.isError).catch(() => undefined);
        })();
      }
      if (ev.type === 'done' || ev.type === 'error') finish();
    };
    transport.startTurn(request, onEvent).catch((e: unknown) => {
      onEvent({ type: 'error', kind: 'unavailable', message: e instanceof Error ? e.message : String(e) });
    });
  });

  return {
    turnId,
    done,
    cancel: () => {
      void transport.cancelTurn(turnId);
    },
  };
}

export interface InlineResult {
  text: string;
  model?: string;
  error?: { kind: string; message: string };
}

export interface InlineTurnOptions {
  provider: AiTurnRequest['provider'];
  model: string;
  prompt: { system: string; user: string; effort?: string };
  onText: (text: string) => void;
  onRateLimit?: (e: Extract<AiEvent, { type: 'rateLimit' }>) => void;
  transport?: AiTransport;
}

/** One tool-less request for an inline command (/polish …); not part of any chat session. */
export function runInlineTurn(opts: InlineTurnOptions): { done: Promise<InlineResult>; cancel: () => void } {
  const transport = opts.transport ?? defaultTransport;
  const turnId = uid();
  const acc: InlineResult = { text: '' };
  const done = new Promise<InlineResult>((resolve) => {
    let settled = false;
    const finish = (error?: InlineResult['error']) => {
      if (settled) return;
      settled = true;
      resolve({ ...acc, error });
    };
    const onEvent = (ev: AiEvent) => {
      if (settled) return;
      switch (ev.type) {
        case 'started':
          acc.model = ev.model;
          break;
        case 'textDelta':
          acc.text += ev.text;
          opts.onText(acc.text);
          break;
        case 'rateLimit':
          opts.onRateLimit?.(ev);
          break;
        case 'done':
          finish();
          break;
        case 'error':
          finish({ kind: ev.kind, message: ev.message });
          break;
      }
    };
    const request: AiTurnRequest = {
      turnId,
      provider: opts.provider,
      model: opts.model,
      system: opts.prompt.system,
      messages: [{ role: 'user', content: opts.prompt.user }],
      tools: [],
      effort: opts.prompt.effort,
    };
    transport.startTurn(request, onEvent).catch((e: unknown) => finish({ kind: 'unavailable', message: e instanceof Error ? e.message : String(e) }));
  });
  return { done, cancel: () => void transport.cancelTurn(turnId).catch(() => false) };
}
