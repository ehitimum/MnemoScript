import type { AiEvent, AiTurnRequest } from './types';

/**
 * Browser-preview-only stand-in for a provider, so the chat UI can be developed and checked in a
 * plain browser (`npm run dev` + `?aimock`). Never active in the Tauri app: `api.ts` only consults
 * it on the browser fallback path. It exercises the real flow: tool calls answered by the
 * frontend, then a streamed reply. A message containing "edit", "fix" or "polish" (in Ask or Auto
 * mode) makes it read the open document and change it, so the change cards can be checked.
 */
export function aiMockEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return new URLSearchParams(window.location.search).has('aimock') || localStorage.getItem('mnemoscript:aimock') === '1';
  } catch {
    return false;
  }
}

const pending = new Map<string, (content: string) => void>();

export function mockToolResult(callId: string, content = ''): void {
  pending.get(callId)?.(content);
  pending.delete(callId);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let seq = 0;

export async function mockTurn(req: AiTurnRequest, onEvent: (e: AiEvent) => void): Promise<void> {
  const model = req.provider === 'claude-code' ? (req.model === 'haiku' ? 'claude-haiku-4-5' : req.model === 'opus' ? 'claude-opus-5-5' : 'claude-sonnet-5') : req.model || 'claude-opus-5-5';
  const tool = (name: string, input: Record<string, unknown>) =>
    new Promise<string>((resolve) => {
      const callId = `mock-${Date.now()}-${seq++}`;
      pending.set(callId, resolve);
      onEvent({ type: 'toolCall', callId, name, input });
    });
  const stream = async (text: string) => {
    for (const word of text.split(/(\s+)/)) {
      onEvent({ type: 'textDelta', text: word });
      await sleep(12);
    }
  };

  // Inline commands (/polish …) are tool-less: rewrite the passage, or continue the story.
  if (!req.tools.length) {
    void (async () => {
      await sleep(200);
      onEvent({ type: 'started', model });
      const user = req.messages[0]?.content ?? '';
      const passage = /<passage>\n([\s\S]*)\n<\/passage>/.exec(user)?.[1];
      let out: string;
      if (!passage) {
        out = 'Rain hammered the shutters while Mara counted the coins a second time.\n\nSomewhere below, a door slammed.';
      } else {
        out = passage.replace(/\bvery\s+/gi, '').replace(/ and /, ', and ');
        if (/two thirds/.test(user)) out = out.split(/(?<=[.!?])\s+/).slice(0, 1).join(' ');
        if (/one and a half/.test(user)) out = `${out} The air smelled of wet stone.`;
        if (out === passage) out = `${passage.replace(/\.$/, '')}, quietly.`;
      }
      for (const word of out.split(/(\s+)/)) {
        onEvent({ type: 'textDelta', text: word });
        await sleep(10);
      }
      onEvent({ type: 'usage', inputTokens: 600, outputTokens: 80, costUsd: 0.002 });
      onEvent({ type: 'done', stopReason: 'end_turn' });
    })();
    return;
  }

  void (async () => {
    await sleep(250);
    onEvent({ type: 'started', model });
    onEvent({ type: 'rateLimit', window: 'five_hour', status: 'allowed', resetsAt: Math.round(Date.now() / 1000) + 8040, utilization: null });
    const listed = await tool('list_documents', {});
    const last = req.messages[req.messages.length - 1]?.content ?? '';
    const canWrite = req.tools.some((t) => t.name === 'edit_text');
    const openId = /\(id ([^)]+)\)/.exec(req.system)?.[1];

    if (canWrite && /\b(edit|fix|polish)\b/i.test(last)) {
      let docs: { id: string; title: string; kind: string }[] = [];
      try {
        docs = JSON.parse(listed);
      } catch {
        /* ignore */
      }
      const target = docs.find((d) => d.id === openId) ?? docs.find((d) => d.kind === 'chapter/note') ?? docs[0];
      if (target) {
        const text = await tool('read_document', { id: target.id });
        let result = '';
        if (target.kind === 'mind map') {
          const first = /- \[([^\]]+)\]/.exec(text)?.[1];
          result = await tool('edit_mind_map', { id: target.id, add_nodes: [{ label: 'A new thread', parent: first }] });
        } else {
          const para = text.split(/\n{2,}/).slice(1).find((p) => p && !/^[#>-]/.test(p));
          if (para) {
            const words = para.split(/\s+/).slice(0, 6).join(' ');
            result = await tool('edit_text', { id: target.id, edits: [{ find: words, replace: `${words} — sharpened` }] });
          }
        }
        await stream(result ? `Done (mock). Tool said: ${result.slice(0, 120)}` : 'There was nothing to edit (mock).');
        onEvent({ type: 'usage', inputTokens: 1500, outputTokens: 90, costUsd: 0.008 });
        onEvent({ type: 'done', stopReason: 'end_turn' });
        return;
      }
    }

    const reply =
      `Here’s a quick read on that (mock reply, ${req.tools.length} tools offered, mode rules in the prompt).\n\n` +
      `**What you asked:** ${last.slice(0, 80)}\n\n` +
      '1. The opening paragraph repeats “and” four times — splitting it would quicken the pace.\n' +
      '2. Mara’s distaste is *told*; one physical reaction would *show* it.\n' +
      '3. The alley chase could end on the torches for a sharper hook.\n\n' +
      '> The tavern roared. Mara slipped through the crowd, breath held against the smoke.\n\n' +
      'Want me to draft the change?';
    await stream(reply);
    onEvent({ type: 'usage', inputTokens: 1234, outputTokens: 210, costUsd: 0.012 });
    onEvent({ type: 'done', stopReason: 'end_turn' });
  })();
}
