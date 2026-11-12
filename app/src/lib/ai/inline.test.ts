import { afterEach, describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { AiTarget, getAiTarget, setAiTarget } from '../../components/extensions/AiTarget';
import { buildInlinePrompt, cleanInlineOutput, INLINE_COMMANDS } from './inline';
import { runInlineTurn, type AiTransport } from './client';
import { applyRewrite, flatten, insertParagraphsAfter } from './rewrite';
import type { AiEvent, AiTurnRequest } from './types';

describe('inline prompts', () => {
  it('wraps the passage, adds context for voice, and asks for less effort on mechanical fixes', () => {
    const p = buildInlinePrompt('proofread', 'Teh rain fell.', 'Earlier text.');
    expect(p.user).toContain('<passage>\nTeh rain fell.\n</passage>');
    expect(p.user).toContain('<context>\nEarlier text.\n</context>');
    expect(p.effort).toBe('low');
    expect(buildInlinePrompt('polish', 'x', '').user).not.toContain('<context>');
    expect(buildInlinePrompt('polish', 'x', '').effort).toBeUndefined();
    expect(buildInlinePrompt('tone', 'x', '', 'lyrical').user).toContain('more lyrical and evocative tone');
    const cont = buildInlinePrompt('continue', '', 'The story so far.');
    expect(cont.user).toContain('<story_so_far>\nThe story so far.\n</story_so_far>');
    expect(cont.system).toMatch(/co-writer/);
    expect(INLINE_COMMANDS.map((c) => c.id)).toEqual(['polish', 'proofread', 'grammar', 'shorten', 'expand', 'tone', 'continue']);
  });

  it('strips the wrappers models add despite instructions', () => {
    expect(cleanInlineOutput("Here's the polished passage:\n\nThe rain fell.", 'x')).toBe('The rain fell.');
    expect(cleanInlineOutput('```\nThe rain fell.\n```', 'x')).toBe('The rain fell.');
    expect(cleanInlineOutput('<passage>\nThe rain fell.\n</passage>', 'x')).toBe('The rain fell.');
    expect(cleanInlineOutput('“The rain fell.”', 'The rain fell.')).toBe('The rain fell.');
    // Dialogue that really is quoted stays quoted.
    expect(cleanInlineOutput('“Run,” she said.”', '“Run,” she said.”')).toBe('“Run,” she said.”');
    expect(cleanInlineOutput('A.\n\n\n\nB.', 'x')).toBe('A.\n\nB.');
  });
});

describe('runInlineTurn', () => {
  it('sends a tool-less request and collects the streamed text and model', async () => {
    let sent: AiTurnRequest | null = null;
    const transport: AiTransport = {
      startTurn: async (req, onEvent) => {
        sent = req;
        const events: AiEvent[] = [
          { type: 'started', model: 'claude-sonnet-5' },
          { type: 'textDelta', text: 'The rain ' },
          { type: 'textDelta', text: 'fell.' },
          { type: 'done', stopReason: 'end_turn' },
        ];
        events.forEach(onEvent);
      },
      toolResult: async () => {},
      cancelTurn: async () => true,
    };
    const seen: string[] = [];
    const run = runInlineTurn({
      provider: 'anthropic',
      model: 'claude-sonnet-5-5',
      prompt: { system: 'S', user: 'U', effort: 'low' },
      onText: (t) => seen.push(t),
      transport,
    });
    expect(await run.done).toEqual({ text: 'The rain fell.', model: 'claude-sonnet-5', error: undefined });
    expect(seen).toEqual(['The rain ', 'The rain fell.']);
    expect(sent).toMatchObject({ tools: [], effort: 'low', messages: [{ role: 'user', content: 'U' }], system: 'S' });
  });

  it('reports errors and a failed start', async () => {
    const failing: AiTransport = {
      startTurn: async () => {
        throw new Error('needs the desktop app');
      },
      toolResult: async () => {},
      cancelTurn: async () => true,
    };
    const r = await runInlineTurn({ provider: 'openai', model: 'gpt-5', prompt: { system: '', user: '' }, onText: () => {}, transport: failing }).done;
    expect(r.error).toEqual({ kind: 'unavailable', message: 'needs the desktop app' });
  });
});

let editor: Editor | null = null;
afterEach(() => {
  editor?.destroy();
  editor = null;
});
const make = (html: string) => (editor = new Editor({ extensions: [StarterKit, AiTarget], content: html }));
const rangeOf = (ed: Editor, startsWith: string) => {
  let r = { from: 0, to: 0 };
  ed.state.doc.descendants((n, p) => {
    if (n.isTextblock && n.textContent.startsWith(startsWith)) r = { from: p + 1, to: p + 1 + n.content.size };
  });
  return r;
};

describe('writing a revision back into the editor', () => {
  it('flattens paragraphs with a position for every character', () => {
    const ed = make('<p>Ab <strong>cd</strong></p><p>Ef</p>');
    const f = flatten(ed.state.doc, 0, ed.state.doc.content.size);
    expect(f.text).toBe('Ab cd\n\nEf');
    expect(f.pos.length).toBe(f.text.length);
    expect(ed.state.doc.textBetween(f.pos[3], f.pos[4] + 1)).toBe('cd');
  });

  it('replaces only changed words (marks survive), across paragraphs, as one undo step', () => {
    const ed = make('<p>She <em>never</em> looked back.</p><p>The rain was very cold.</p>');
    const all = { from: 0, to: ed.state.doc.content.size };
    const before = flatten(ed.state.doc, all.from, all.to).text;
    expect(applyRewrite(ed, all.from, all.to, 'She <em>never</em> once looked back.\n\nThe rain was cold.'.replace(/<\/?em>/g, ''), before)).toBe(true);
    expect(ed.getHTML()).toBe('<p>She <em>never</em> once looked back.</p><p>The rain was cold.</p>');
    ed.commands.undo();
    expect(ed.getHTML()).toBe('<p>She <em>never</em> looked back.</p><p>The rain was very cold.</p>');
  });

  it('falls back to plain paragraphs when the paragraph structure changes, and refuses stale text', () => {
    const ed = make('<p>One. Two.</p><p>Three.</p>');
    const r = rangeOf(ed, 'One');
    expect(applyRewrite(ed, r.from, r.to, 'One.\n\nTwo.', 'One. Two.')).toBe(true);
    expect(ed.getHTML()).toBe('<p>One.</p><p>Two.</p><p>Three.</p>');
    const t = rangeOf(ed, 'Three');
    expect(applyRewrite(ed, t.from, t.to, 'Four.', 'Something else')).toBe(false);
    expect(ed.getHTML()).toContain('<p>Three.</p>');
  });

  it('continue inserts new paragraphs after the paragraph at the cursor', () => {
    const ed = make('<p>First.</p><p>Last.</p>');
    insertParagraphsAfter(ed, rangeOf(ed, 'First').to, 'New one.\n\nNew two.');
    expect(ed.getHTML()).toBe('<p>First.</p><p>New one.</p><p>New two.</p><p>Last.</p>');
  });

  it('keeps the target range mapped while the writer types elsewhere', () => {
    const ed = make('<p>Alpha.</p><p>Beta.</p>');
    const r = rangeOf(ed, 'Beta');
    setAiTarget(ed, { ...r, running: true });
    ed.commands.insertContentAt(1, 'Very ');
    const t = getAiTarget(ed)!;
    expect(ed.state.doc.textBetween(t.from, t.to)).toBe('Beta.');
    ed.commands.undo(); // the highlight itself never enters the undo history
    expect(ed.getHTML()).toBe('<p>Alpha.</p><p>Beta.</p>');
  });
});
