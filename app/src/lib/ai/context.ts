import { modelLabel } from './providers';
import { toolsForMode } from './tools';
import type { AiMode, AiProviderId, AiSession, AiTurnRequest } from './types';

/**
 * Builds the provider-neutral request for one turn from the stored session. Because MnemoScript
 * owns the transcript, any provider/model can continue any session (verified in Phase 0, T4):
 * earlier replies from other models are replayed as plain text, tool use as short summaries.
 */

const MODE_RULES: Record<AiMode, string> = {
  plan:
    'Mode: PLAN. You can read the project but not change it. When the writer asks for changes, reply with a short numbered plan of what you would change and why; they can switch to Ask or Auto to carry it out.',
  ask:
    'Mode: ASK FIRST. Each change you make with a tool is shown to the writer, who applies or rejects it; the tool result says which. ' +
    'If they reject one, do not retry it unless they ask. Explain each change briefly.',
  auto:
    'Mode: AUTO. Changes you make with a tool are applied straight away (the writer can undo them). Make focused changes and say what you changed.',
};

export interface TurnContext {
  turnId: string;
  provider: AiProviderId;
  model: string;
  mode: AiMode;
  projectName: string;
  /** The document the writer has open, if any. */
  activeDocument?: { id: string; title: string } | null;
}

export function buildSystemPrompt(session: AiSession, ctx: TurnContext): string {
  const parts = [
    `You are the writing assistant inside MnemoScript, a writing studio for novelists. The writer's project is "${ctx.projectName}".`,
    'You can only see and change the project through the provided tools. Call list_documents before using an id; never invent ids or content you have not read.',
    "Keep the author's voice, style and spelling conventions. Be concise; this is a working session, not an essay.",
    ...(ctx.mode === 'plan'
      ? []
      : [
          'To change a chapter, read it first, then use edit_text with exact quotes; keep each edit as small as the request allows. ' +
            'Only use write_document for an empty document or a full rewrite the writer asked for. Never change documents the writer did not ask about.',
        ]),
    MODE_RULES[ctx.mode],
  ];
  if (ctx.activeDocument) {
    parts.push(`The writer currently has "${ctx.activeDocument.title}" open (id ${ctx.activeDocument.id}).`);
  }
  const otherModels = [
    ...new Set(
      session.messages
        .filter((m) => m.role === 'assistant' && m.model && m.model !== ctx.model)
        .map((m) => modelLabel(m.model!)),
    ),
  ];
  if (otherModels.length) {
    parts.push(
      `Earlier replies in this conversation were written by other AI models (${otherModels.join(', ')}). ` +
        'The writer switched models; treat those replies as the conversation so far and continue from them.',
    );
  }
  return parts.join('\n\n');
}

const STATUS_NOTE: Record<string, string> = {
  pending: 'not decided',
  applied: 'applied',
  rejected: 'rejected by the writer',
  undone: 'undone by the writer',
  failed: 'failed',
};

/** "edit_text on “Chapter 1” (applied)" — so a later turn (maybe another model) knows what happened. */
function toolSummary(c: NonNullable<AiSession['messages'][number]['toolCalls']>[number]): string {
  if (!c.change) return c.name;
  return `${c.name} on “${c.change.docTitle}” (${STATUS_NOTE[c.change.status] ?? c.change.status})`;
}

/** Session (already ending with the new user message) → request messages. */
export function buildMessages(session: AiSession): AiTurnRequest['messages'] {
  const out: AiTurnRequest['messages'] = [];
  for (const m of session.messages) {
    if (m.pending) continue;
    let content = m.text.trim();
    if (m.role === 'assistant' && m.toolCalls?.length) {
      const used = m.toolCalls.map(toolSummary).join(', ');
      content = content ? `${content}\n\n(Tools used: ${used})` : `(Tools used: ${used})`;
    }
    if (!content) continue; // e.g. a reply that failed before producing text
    const last = out[out.length - 1];
    if (last && last.role === m.role) {
      last.content += `\n\n${content}`; // keep strict user/assistant alternation
    } else {
      out.push({ role: m.role, content });
    }
  }
  while (out.length && out[0].role !== 'user') out.shift();
  return out;
}

export function buildTurnRequest(session: AiSession, ctx: TurnContext): AiTurnRequest {
  return {
    turnId: ctx.turnId,
    provider: ctx.provider,
    model: ctx.model,
    system: buildSystemPrompt(session, ctx),
    messages: buildMessages(session),
    tools: toolsForMode(ctx.mode),
  };
}
