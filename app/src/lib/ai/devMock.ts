import type { AiEvent, AiTurnRequest } from './types';

/**
 * Browser-preview-only stand-in for a provider, so the chat UI can be developed and checked in a
 * plain browser (`npm run dev` + `?aimock`). Never active in the Tauri app: `api.ts` only consults
 * it on the browser fallback path. It exercises the real flow: a tool call answered by the
 * frontend, then a streamed reply.
 */
export function aiMockEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return new URLSearchParams(window.location.search).has('aimock') || localStorage.getItem('mnemoscript:aimock') === '1';
  } catch {
    return false;
  }
}

const pending = new Map<string, () => void>();

export function mockToolResult(callId: string): void {
  pending.get(callId)?.();
  pending.delete(callId);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function mockTurn(req: AiTurnRequest, onEvent: (e: AiEvent) => void): Promise<void> {
  const model = req.provider === 'claude-code' ? (req.model === 'haiku' ? 'claude-haiku-4-5' : req.model === 'opus' ? 'claude-opus-5-5' : 'claude-sonnet-5') : req.model || 'claude-opus-5-5';
  void (async () => {
    await sleep(250);
    onEvent({ type: 'started', model });
    onEvent({ type: 'rateLimit', window: 'five_hour', status: 'allowed', resetsAt: Math.round(Date.now() / 1000) + 8040, utilization: null });
    const callId = `mock-${Date.now()}`;
    await new Promise<void>((resolve) => {
      pending.set(callId, resolve);
      onEvent({ type: 'toolCall', callId, name: 'list_documents', input: {} });
    });
    const last = req.messages[req.messages.length - 1]?.content ?? '';
    const reply =
      `Here’s a quick read on that (mock reply, ${req.tools.length} tools offered, mode rules in the prompt).\n\n` +
      `**What you asked:** ${last.slice(0, 80)}\n\n` +
      '1. The opening paragraph repeats “and” four times — splitting it would quicken the pace.\n' +
      '2. Mara’s distaste is *told*; one physical reaction would *show* it.\n' +
      '3. The alley chase could end on the torches for a sharper hook.\n\n' +
      '> The tavern roared. Mara slipped through the crowd, breath held against the smoke.\n\n' +
      'Want me to draft the change?';
    for (const word of reply.split(/(\s+)/)) {
      onEvent({ type: 'textDelta', text: word });
      await sleep(12);
    }
    onEvent({ type: 'usage', inputTokens: 1234, outputTokens: 210, costUsd: 0.012 });
    onEvent({ type: 'done', stopReason: 'end_turn' });
  })();
}
