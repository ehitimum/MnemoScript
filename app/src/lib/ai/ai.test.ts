import { describe, it, expect } from 'vitest';
import type { Document } from '../../types';
import { api } from '../api';
import { runTurn, type AiTransport } from './client';
import { buildMessages, buildTurnRequest } from './context';
import { documentToText, htmlToText } from './documents';
import { getProvider, modelLabel, providersFor, vendorOfModel } from './providers';
import { addUserMessage, applyEvent, forStorage, newSession, startAssistantMessage, withAssistantMessage } from './session';
import { executeTool, toolsForMode } from './tools';
import type { AiEvent, AiSession, AiTurnRequest } from './types';

const doc = (id: string, title: string, content: string, docType: Document['docType'] = 'text'): Document => ({
  id, title, content, docType, updated_at: '2026-11-12T00:00:00Z', order: 0,
});
const DOCS = [
  doc('ch3', 'Chapter 3', '<h1>The Ember Crown</h1><p>The tavern was <b>loud</b>.</p><ul data-type="taskList"><li data-checked="true"><p>fix</p></li></ul>'),
  doc('map1', 'Characters', JSON.stringify({ nodes: [{ id: 'n1', data: { label: 'Mara' } }, { id: 'n2', data: { label: 'Caddoc' } }], edges: [{ source: 'n2', target: 'n1', label: 'uncle' }] }), 'mindmap'),
  doc('w1', 'World', JSON.stringify({ kind: 'world', regions: [{ id: 'r1', name: 'Northreach', level: 'realm' }], labels: [{ id: 'l1', text: 'Ashen Sea' }], items: [{ id: 'i1', label: 'Emberkeep' }], routes: [{ id: 'x', kind: 'road' }] }), 'fantasymap'),
];
const access = { listDocuments: () => DOCS };

describe('providers', () => {
  it('lets one subscription switch models and hides CLIs on phones', () => {
    const claude = getProvider('claude-code');
    expect(claude.models.map((m) => m.id)).toEqual(['', 'opus', 'sonnet', 'haiku', 'fable']);
    expect(providersFor(true).map((p) => p.id)).not.toContain('claude-code');
    expect(providersFor(false)).toHaveLength(4);
  });

  it('labels resolved model ids and knows their vendor', () => {
    expect(modelLabel('claude-haiku-4-5-20251001')).toBe('Claude Haiku 4.5');
    expect(modelLabel('claude-sonnet-5')).toBe('Claude Sonnet 5');
    expect(modelLabel('claude-opus-5-5')).toBe('Claude Opus 5.5');
    expect(modelLabel('claude-sonnet-5[1m]')).toBe('Claude Sonnet 5');
    expect(modelLabel('gpt-5-mini')).toBe('GPT-5 mini');
    expect(modelLabel('gemini-2.5-pro')).toBe('Gemini 2.5 Pro');
    expect(vendorOfModel('sonnet')).toBe('anthropic');
    expect(vendorOfModel('gpt-5')).toBe('openai');
    expect(vendorOfModel('gemini-2.5-flash')).toBe('google');
  });
});

describe('documents → model text', () => {
  it('flattens chapter HTML to readable plain text', () => {
    expect(htmlToText(DOCS[0].content)).toBe('# The Ember Crown\n\nThe tavern was loud.\n\n- [x] fix');
    expect(htmlToText('<ul><li><p>Act I</p><ul><li><p>Tavern</p></li></ul></li></ul><blockquote><p>Run.</p></blockquote>'))
      .toBe('- Act I\n\n  - Tavern\n\n> Run.');
  });
  it('summarises mind maps and fantasy maps', () => {
    expect(documentToText(DOCS[1])).toContain('- Caddoc → Mara (uncle)');
    const map = documentToText(DOCS[2]);
    expect(map).toContain('[r1] Northreach (realm)');
    expect(map).toContain('[i1] Emberkeep');
    expect(map).toContain('1 roads');
  });
});

describe('tools', () => {
  it('lists and reads documents', async () => {
    const list = await executeTool('list_documents', {}, access, 'ask');
    expect(JSON.parse(list.content)[1]).toEqual({ id: 'map1', title: 'Characters', kind: 'mind map', folderId: null });
    const read = await executeTool('read_document', { id: 'ch3' }, access, 'plan');
    expect(read.content).toMatch(/^# Chapter 3 \(chapter\/note\)/);
    expect((await executeTool('read_document', { id: 'nope' }, access, 'plan')).isError).toBe(true);
  });
  it('refuses tools the mode does not offer', async () => {
    expect(toolsForMode('plan').map((t) => t.name)).toEqual(['list_documents', 'read_document']);
    const r = await executeTool('edit_text', { id: 'ch3' }, access, 'plan');
    expect(r).toEqual({ content: 'The tool "edit_text" is not available in plan mode.', isError: true });
  });
});

/** A session where GPT and Gemini answered earlier (the Phase 0 handoff scenario). */
function mixedSession(): AiSession {
  let s = newSession('openai');
  s = addUserMessage(s, 'Give Caddoc a secret.');
  s = withAssistantMessage(s, { ...startAssistantMessage('openai', 'gpt-5', 'ask'), text: 'He is her uncle.', pending: false, toolCalls: [{ callId: 'c', name: 'read_document', input: { id: 'map1' } }] });
  s = addUserMessage(s, 'Which object reveals it?');
  s = withAssistantMessage(s, { ...startAssistantMessage('gemini', 'gemini-2.5-pro', 'ask'), text: 'A silver ring.', pending: false });
  return addUserMessage(s, 'Continue from before.');
}

describe('context (provider-neutral turns)', () => {
  it('replays other models’ replies and tells the new model about the switch', () => {
    const req = buildTurnRequest(mixedSession(), { turnId: 't', provider: 'claude-code', model: 'sonnet', mode: 'plan', projectName: 'The Ember Crown' });
    expect(req.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant', 'user']);
    expect(req.messages[1].content).toBe('He is her uncle.\n\n(Tools used: read_document)');
    expect(req.system).toContain('other AI models (GPT-5, Gemini 2.5 Pro)');
    expect(req.system).toContain('Mode: PLAN');
    expect(req.tools.map((t) => t.name)).toEqual(['list_documents', 'read_document']);
  });

  it('keeps strict alternation and skips empty / failed replies', () => {
    let s = newSession('anthropic');
    s = addUserMessage(s, 'one');
    s = withAssistantMessage(s, { ...startAssistantMessage('anthropic', '', 'ask'), pending: false, error: { kind: 'network', message: 'x' } });
    s = addUserMessage(s, 'two');
    expect(buildMessages(s)).toEqual([{ role: 'user', content: 'one\n\ntwo' }]);
  });
});

describe('session helpers', () => {
  it('titles from the first message, tracks models newest-first, never stores a pending reply', () => {
    let s = addUserMessage(newSession('claude-code'), 'Tighten the pacing of chapter three, especially the tavern scene where Mara waits');
    expect(s.title.endsWith('…')).toBe(true);
    let reply = startAssistantMessage('claude-code', 'haiku', 'ask');
    reply = applyEvent(reply, { type: 'started', model: 'claude-haiku-4-5-20251001' });
    reply = applyEvent(reply, { type: 'textDelta', text: 'Sure' });
    s = withAssistantMessage(s, reply);
    expect(s.models).toEqual([]); // still streaming
    expect(forStorage(s).messages[1]).toMatchObject({ pending: false, error: { kind: 'cancelled' } });
    s = withAssistantMessage(s, applyEvent(reply, { type: 'done', stopReason: 'end_turn' }));
    expect(s.models).toEqual(['claude-haiku-4-5-20251001']);
  });
});

describe('runTurn', () => {
  it('streams a reply, runs tool calls locally and returns their results to the backend', async () => {
    const sent: AiTurnRequest[] = [];
    const results: string[] = [];
    let emit: (e: AiEvent) => void = () => {};
    const transport: AiTransport = {
      startTurn: async (req, onEvent) => {
        sent.push(req);
        emit = onEvent;
        onEvent({ type: 'started', model: 'claude-sonnet-5' });
        onEvent({ type: 'toolCall', callId: 'c1', name: 'list_documents', input: {} });
      },
      toolResult: async (_t, callId, content) => {
        results.push(`${callId}:${content.slice(0, 12)}`);
        emit({ type: 'textDelta', text: 'Three documents.' });
        emit({ type: 'usage', inputTokens: 10, outputTokens: 3, costUsd: 0.01 });
        emit({ type: 'done', stopReason: 'end_turn' });
      },
      cancelTurn: async () => true,
    };
    const turn = runTurn({ session: newSession('claude-code'), userText: 'What is in my project?', provider: 'claude-code', model: 'sonnet', mode: 'ask', projectName: 'P', access, transport });
    const final = await turn.done;
    expect(sent[0].messages).toEqual([{ role: 'user', content: 'What is in my project?' }]);
    expect(results).toEqual(['c1:[{"id":"ch3"']);
    const reply = final.messages[1];
    expect(reply).toMatchObject({ text: 'Three documents.', model: 'claude-sonnet-5', pending: false, usage: { costUsd: 0.01 } });
    expect(reply.toolCalls?.[0].result).toContain('Chapter 3');
    expect(final.models).toEqual(['claude-sonnet-5']);
  });

  it('turns a failed start into an error on the reply', async () => {
    const transport: AiTransport = {
      startTurn: async () => { throw new Error('No provider'); },
      toolResult: async () => {},
      cancelTurn: async () => false,
    };
    const final = await runTurn({ session: newSession('openai'), userText: 'hi', provider: 'openai', model: '', mode: 'ask', projectName: 'P', access, transport }).done;
    expect(final.messages[1].error).toEqual({ kind: 'unavailable', message: 'No provider' });
  });
});

describe('api: AI sessions (browser fallback)', () => {
  it('scopes sessions to their project', async () => {
    const a = await api.createProject('A');
    const b = await api.createProject('B');
    const s = addUserMessage(newSession('anthropic'), 'hello');
    await api.saveAiSession(a.id, s);
    expect((await api.listAiSessions(a.id)).map((x) => x.id)).toEqual([s.id]);
    expect(await api.listAiSessions(b.id)).toEqual([]);
    expect((await api.loadAiSession(a.id, s.id)).messages[0].text).toBe('hello');
    await api.deleteAiSession(a.id, s.id);
    expect(await api.listAiSessions(a.id)).toEqual([]);
  });

  it('reports that providers need the native app', async () => {
    expect(await api.aiKeyStatus()).toEqual({ anthropic: false, openai: false, gemini: false });
    await expect(api.aiStartTurn({} as AiTurnRequest, () => {})).rejects.toThrow(/desktop or Android/);
  });
});
