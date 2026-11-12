import { describe, expect, it } from 'vitest';
import type { Document } from '../../types';
import { htmlToText } from './documents';
import { paragraphHunks, textHash, wordDiff } from './diff';
import { applyFantasyMapEdit, applyMindMapEdit, newMindMap } from './structEdits';
import { applyTextEdits, EditError, textToHtml } from './textEdits';
import { executeTool, toolsForMode, type ProjectAccess } from './tools';
import { buildMessages } from './context';
import { forStorage, newSession } from './session';
import { nextMindNodeIndex } from '../canvasFlush';

const CHAPTER =
  '<h1>The Ashen Crown</h1><p>The tavern roared and <strong>Mara slipped</strong> through the crowd.</p>' +
  '<p>She hated the smoke.</p><p></p><p>Outside, “the rain” fell.</p>' +
  '<ul><li><p>bread</p></li><li><p>salt</p></li></ul>';

describe('text edits', () => {
  it('replaces inside a paragraph and keeps the formatting around it', () => {
    const out = applyTextEdits(CHAPTER, [{ find: 'Mara slipped', replace: 'Mara edged' }]);
    expect(out).toContain('<strong>Mara edged</strong>');
    expect(out).toContain('<h1>The Ashen Crown</h1>');
  });

  it('changes only the words that differ, so formatting on kept words survives', () => {
    const out = applyTextEdits('<p>She <em>never</em> looked <strong>back</strong> at him.</p>', [
      { find: 'She never looked back at him.', replace: 'She never once looked back at them.' },
    ]);
    expect(out).toBe('<p>She <em>never</em> once looked <strong>back</strong> at them.</p>');
  });

  it('matches curly quotes, collapsed spaces and list/heading markers', () => {
    let out = applyTextEdits(CHAPTER, [{ find: 'Outside, "the rain"  fell.', replace: 'Outside, the rain fell harder.' }]);
    expect(htmlToText(out)).toContain('Outside, the rain fell harder.');
    out = applyTextEdits(CHAPTER, [{ find: '# The Ashen Crown', replace: '# The Iron Crown' }]);
    expect(out).toContain('<h1>The Iron Crown</h1>');
    out = applyTextEdits(CHAPTER, [{ find: '- salt', replace: '- pepper' }]);
    expect(out).toContain('<li><p>pepper</p></li>');
  });

  it('replaces across paragraphs, deletes paragraphs and inserts new ones', () => {
    const merged = applyTextEdits(CHAPTER, [{ find: 'through the crowd.\n\nShe hated', replace: 'through the crowd; she hated' }]);
    expect(htmlToText(merged)).toContain('The tavern roared and Mara slipped through the crowd; she hated the smoke.');
    const overBlank = applyTextEdits(CHAPTER, [{ find: 'the smoke.\n\nOutside,', replace: 'the smoke. Outside,' }]);
    expect(overBlank).not.toContain('<p></p>'); // the blank paragraph inside the match went too

    const deleted = applyTextEdits(CHAPTER, [{ find: 'She hated the smoke.', replace: '' }]);
    expect(htmlToText(deleted)).not.toContain('smoke');
    expect(deleted).not.toContain('<p></p><p></p>');

    const inserted = applyTextEdits(CHAPTER, [
      { find: 'She hated the smoke.', replace: 'She hated the smoke.\n\nA bell rang **twice**.' },
    ]);
    expect(inserted).toContain('<p>A bell rang <strong>twice</strong>.</p>');
    expect(htmlToText(inserted).split('\n\n')).toContain('She hated the smoke.');
  });

  it('splits a paragraph and keeps what follows the match', () => {
    const out = applyTextEdits('<p>One two three four.</p>', [{ find: 'two', replace: 'two.\n\nThen' }]);
    expect(htmlToText(out)).toBe('One two.\n\nThen three four.');
  });

  it('refuses text that is missing or ambiguous, and applies nothing on failure', () => {
    expect(() => applyTextEdits(CHAPTER, [{ find: 'dragon', replace: 'x' }])).toThrow(EditError);
    expect(() => applyTextEdits('<p>and and</p>', [{ find: 'and', replace: 'or' }])).toThrow(/appears 2 times/);
    expect(() => applyTextEdits(CHAPTER, [{ find: 'smoke', replace: 'fog' }, { find: 'nope', replace: '' }])).toThrow(/Edit 2/);
  });

  it('turns light markdown into editor blocks', () => {
    const html = textToHtml('# Title\n\nA *quiet* line.\n- one\n- two\n1. first\n- [x] done\n> said\n\n* * *');
    expect(html).toBe(
      '<h1>Title</h1><p>A <em>quiet</em> line.</p><ul><li><p>one</p></li><li><p>two</p></li></ul><ol><li><p>first</p></li></ol>' +
        '<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>done</p></li></ul><blockquote><p>said</p></blockquote><hr>',
    );
  });
});

describe('diffs', () => {
  it('groups changed paragraphs into hunks and diffs words inside them', () => {
    const hunks = paragraphHunks('A\n\nB c d\n\nE\n\nF', 'A\n\nB x d\n\nE\n\nG\n\nH');
    expect(hunks).toEqual([
      { before: 'B c d', after: 'B x d' },
      { before: 'F', after: 'G\n\nH' },
    ]);
    expect(wordDiff('the old door', 'the new door')).toEqual([
      { type: 'eq', text: 'the ' },
      { type: 'del', text: 'old' },
      { type: 'ins', text: 'new' },
      { type: 'eq', text: ' door' },
    ]);
    expect(textHash('a')).not.toBe(textHash('b'));
  });
});

const MIND = JSON.stringify({
  nodes: [
    { id: 'n1', type: 'editable', position: { x: 0, y: 0 }, data: { label: 'Mara', color: '#6366f1' }, measured: { width: 170 } },
    { id: 'n3', type: 'editable', position: { x: 300, y: 0 }, data: { label: 'Tomas', color: '#0ea5e9' } },
  ],
  edges: [{ id: 'e1', source: 'n1', target: 'n3' }],
});

describe('mind map and fantasy map edits', () => {
  it('adds nodes under a parent (linked, not overlapping), chains refs, renames and removes', () => {
    const r = applyMindMapEdit(MIND, {
      add_nodes: [
        { ref: 'a', label: 'Her past', parent: 'n1' },
        { label: 'The fire', parent: 'a' },
      ],
      rename_nodes: [{ id: 'n3', label: 'Tomas the smith' }],
    });
    const m = JSON.parse(r.content);
    expect(m.nodes).toHaveLength(4);
    expect(m.nodes[0].measured).toEqual({ width: 170 }); // untouched fields survive
    const past = m.nodes.find((n: { data: { label: string } }) => n.data.label === 'Her past');
    expect(m.edges.some((e: { source: string; target: string }) => e.source === 'n1' && e.target === past.id)).toBe(true);
    expect(past.position.y).toBeGreaterThan(0);
    expect(r.lines.map((l) => l.op)).toEqual(['change', 'add', 'add']);

    const removed = JSON.parse(applyMindMapEdit(MIND, { remove_nodes: ['n3'] }).content);
    expect(removed.nodes).toHaveLength(1);
    expect(removed.edges).toHaveLength(0);
    expect(() => applyMindMapEdit(MIND, { rename_nodes: [{ id: 'zz', label: 'x' }] })).toThrow(/no node has the id/);
    expect(() => applyMindMapEdit(MIND, {})).toThrow(/Nothing to change/);
    expect(JSON.parse(newMindMap('Cast', ['Mara', 'Tomas'])).nodes).toHaveLength(3);
  });

  it('renames regions and places and edits labels on a fantasy map', () => {
    const map = JSON.stringify({
      style: 'handdrawn',
      terrain: { seed: 7 },
      regions: [{ id: 'r1', name: 'Vale', points: [0, 0, 100, 0, 100, 100, 0, 100] }],
      items: [{ id: 'i1', x: 10, y: 10, label: 'Keep' }],
      labels: [{ id: 'l1', text: 'Old Sea', x: 1, y: 2 }],
    });
    const r = applyFantasyMapEdit(map, {
      rename_regions: [{ id: 'r1', name: 'Emberdale' }],
      rename_places: [{ id: 'i1', label: 'Ashkeep' }],
      edit_labels: [{ id: 'l1', text: 'Grey Sea' }],
      add_labels: [{ text: 'Here be wolves', near: 'r1' }],
    });
    const m = JSON.parse(r.content);
    expect(m.terrain).toEqual({ seed: 7 });
    expect(m.regions[0].name).toBe('Emberdale');
    expect(m.items[0].label).toBe('Ashkeep');
    expect(m.labels.map((l: { text: string }) => l.text)).toEqual(['Grey Sea', 'Here be wolves']);
    expect(m.labels[1]).toMatchObject({ x: 50, y: 84, color: '#9e2b25' });
  });

  it('picks mind map ids that cannot collide with existing ones', () => {
    expect(nextMindNodeIndex([{ id: 'n1' }, { id: 'n5' }])).toBe(6);
    expect(nextMindNodeIndex([{ id: 'ai-x' }, { id: 'ai-y' }])).toBe(3);
  });
});

function project(docs: Document[]) {
  const store = new Map(docs.map((d) => [d.id, d]));
  const access: ProjectAccess & { store: typeof store } = {
    store,
    listDocuments: () => [...store.values()],
    applyContent: async (id, content) => {
      store.set(id, { ...store.get(id)!, content });
    },
    createDocument: async (title, docType, content) => {
      const d: Document = { id: `d${store.size + 1}`, title, docType, content, order: store.size, updated_at: '' };
      store.set(d.id, d);
      return d;
    },
  };
  return access;
}

const doc = (id: string, title: string, content: string, docType: Document['docType'] = 'text'): Document => ({
  id,
  title,
  content,
  docType,
  order: 0,
  updated_at: '',
});

describe('write tools and modes', () => {
  it('never offers or runs a write tool in plan mode', async () => {
    expect(toolsForMode('plan').map((t) => t.name)).toEqual(['list_documents', 'read_document']);
    expect(toolsForMode('auto').map((t) => t.name)).toContain('edit_text');
    const access = project([doc('c1', 'One', '<p>Hello there.</p>')]);
    const r = await executeTool('edit_text', { id: 'c1', edits: [{ find: 'Hello', replace: 'Hi' }] }, access, 'plan');
    expect(r.isError).toBe(true);
    expect(access.store.get('c1')!.content).toBe('<p>Hello there.</p>');
  });

  it('auto mode applies, keeps the old content for undo, and accepts edits sent as a JSON string', async () => {
    const access = project([doc('c1', 'One', '<p>Hello there.</p>')]);
    const r = await executeTool('edit_text', { id: 'c1', edits: '[{"find":"Hello","replace":"Hi"}]' }, access, 'auto');
    expect(r.isError).toBe(false);
    expect(access.store.get('c1')!.content).toBe('<p>Hi there.</p>');
    expect(r.change).toMatchObject({ status: 'applied', before: '<p>Hello there.</p>', summary: '1 edit', docTitle: 'One' });
    expect(r.change!.afterHash).toBe(textHash('Hi there.'));
    expect(r.change!.preview).toEqual({ kind: 'text', hunks: [{ before: 'Hello there.', after: 'Hi there.' }] });
  });

  it('ask mode shows the proposal, then applies or rejects on the writer’s answer', async () => {
    const access = project([doc('c1', 'One', '<p>Hello there.</p>')]);
    let answer!: (ok: boolean) => void;
    access.requestApproval = () => new Promise((res) => (answer = res));
    const proposals: string[] = [];
    const running = executeTool('edit_text', { id: 'c1', edits: [{ find: 'Hello', replace: 'Hi' }] }, access, 'ask', {
      callId: 'x',
      onProposal: (c) => proposals.push(c.status),
    });
    await Promise.resolve();
    expect(proposals).toEqual(['pending']);
    expect(access.store.get('c1')!.content).toBe('<p>Hello there.</p>'); // nothing written yet
    // The writer edits while deciding: the approved change applies to the new text.
    access.store.set('c1', doc('c1', 'One', '<p>Hello there, friend.</p>'));
    answer(true);
    const r = await running;
    expect(r.change?.status).toBe('applied');
    expect(access.store.get('c1')!.content).toBe('<p>Hi there, friend.</p>');

    access.requestApproval = async () => false;
    const rejected = await executeTool('write_document', { id: 'c1', text: 'Gone' }, access, 'ask', { callId: 'y' });
    expect(rejected).toMatchObject({ isError: false, change: { status: 'rejected' } });
    expect(rejected.content).toMatch(/rejected/);
    expect(access.store.get('c1')!.content).toBe('<p>Hi there, friend.</p>');
  });

  it('points the model at the right tool and creates documents', async () => {
    const access = project([doc('m1', 'Cast', MIND, 'mindmap')]);
    const wrong = await executeTool('edit_text', { id: 'm1', edits: [{ find: 'a', replace: 'b' }] }, access, 'auto');
    expect(wrong.content).toMatch(/use edit_mind_map/);
    const made = await executeTool('create_document', { title: 'Chapter 2', kind: 'text', text: 'It began.' }, access, 'auto');
    expect(made.change).toMatchObject({ status: 'applied', created: true, docId: 'd2', summary: 'New chapter' });
    expect(access.store.get('d2')!.content).toBe('<p>It began.</p>');
  });
});

describe('sessions with changes', () => {
  it('never stores a proposal as still pending, and replays outcomes to the next model', () => {
    const s = newSession('anthropic');
    s.messages.push(
      { id: 'u', role: 'user', text: 'tidy it', createdAt: '' },
      {
        id: 'a',
        role: 'assistant',
        text: 'Done.',
        createdAt: '',
        pending: true,
        toolCalls: [
          {
            callId: 'c',
            name: 'edit_text',
            input: {},
            change: { docId: 'c1', docTitle: 'One', docType: 'text', summary: '1 edit', preview: { kind: 'text', hunks: [] }, status: 'pending' },
          },
        ],
      },
    );
    const stored = forStorage(s);
    expect(stored.messages[1].toolCalls![0].change!.status).toBe('rejected');
    stored.messages.push({ id: 'u2', role: 'user', text: 'thanks', createdAt: '' });
    expect(buildMessages(stored)[1].content).toContain('edit_text on “One” (rejected by the writer)');
  });
});
