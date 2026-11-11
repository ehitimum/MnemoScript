import { api } from '../api';
import { buildTurnRequest, type TurnContext } from './context';
import { addUserMessage, applyEvent, recordToolResult, startAssistantMessage, uid, withAssistantMessage } from './session';
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

  const update = (next: typeof reply) => {
    reply = next;
    session = withAssistantMessage(session, reply);
    opts.onUpdate?.(session);
  };

  const done = new Promise<AiSession>((resolve) => {
    let settled = false;
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
          const r = await executeTool(ev.name, ev.input, opts.access, opts.mode).catch((e: unknown) => ({
            content: `Tool failed: ${e instanceof Error ? e.message : String(e)}`,
            isError: true,
          }));
          update(recordToolResult(reply, ev.callId, r.content, r.isError));
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
