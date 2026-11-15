import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { Editor } from '@tiptap/react';
import type { SyncAppliedEvent, SyncStatus } from '../lib/sync/types';

// Drive the App's sync boundary directly: status pushes and "applied" events from the backend.
const sync = vi.hoisted(() => ({
  status: null as SyncStatus | null,
  applied: null as ((e: SyncAppliedEvent) => void) | null,
}));
vi.mock('../lib/sync/useSync', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/sync/useSync')>();
  const { UNSUPPORTED_STATUS } = await import('../lib/sync/types');
  return {
    ...actual,
    useSyncStatus: () => ({ status: sync.status ?? UNSUPPORTED_STATUS, setStatus: vi.fn(), refresh: vi.fn() }),
    useSyncApplied: (handler: (e: SyncAppliedEvent) => void) => { sync.applied = handler; },
  };
});

beforeAll(async () => { await import('../App'); }, 60000);
beforeEach(() => { sync.status = null; sync.applied = null; localStorage.clear(); });

type Stored = { id: string; documents: { id: string; title: string; content: string }[] }[];
const stored = () => JSON.parse(localStorage.getItem('mnemoscript:projects')!) as Stored;
function writeStored(f: (p: Stored) => void) {
  const projects = stored();
  f(projects);
  localStorage.setItem('mnemoscript:projects', JSON.stringify(projects));
}

async function openChapter(text: string) {
  const { default: App } = await import('../App');
  const { api } = await import('../lib/api');
  const view = render(<App />);
  // Generous waits: the full suite mounts many TipTap trees in parallel on slow machines.
  const slow = { timeout: 10000 };
  fireEvent.click(screen.getByText(/start a novel/i).closest('button')!);
  const input = await screen.findByPlaceholderText(/ashen crown/i, {}, slow);
  fireEvent.change(input, { target: { value: 'Synced Novel' } });
  fireEvent.submit(input.closest('form')!);
  fireEvent.click(await screen.findByRole('button', { name: /new chapter/i }, slow));
  await waitFor(() => expect(document.querySelector('.ProseMirror')).toBeTruthy(), slow);
  const editor = (document.querySelector('.ProseMirror') as HTMLElement & { editor: Editor }).editor;
  act(() => { editor.commands.setContent(text, { emitUpdate: true }); });
  const project = stored()[0];
  return { api, editor, view, projectId: project.id, docId: project.documents[0].id };
}

describe('Sync boundary in the app (regression)', () => {
  it('tells the backend which chapter is open so its text is never replaced under the editor', async () => {
    const { api } = await import('../lib/api');
    const active = vi.spyOn(api, 'syncSetActive');
    const { projectId, docId } = await openChapter('<p>Draft</p>');
    await waitFor(() => expect(active).toHaveBeenCalledWith(projectId, docId));
    active.mockRestore();
  });

  it('takes a remote rename of the open chapter without losing unsaved typing or reverting the title', async () => {
    const { editor, projectId, docId } = await openChapter('<p>Unsaved words typed here</p>');
    // Another device renamed the chapter; sync wrote it to disk (the browser store here).
    writeStored((p) => { p[0].documents[0].title = 'The Bells'; });
    await act(async () => sync.applied!({ projectId, changed: [`doc:${docId}`], staged: [] }));
    await waitFor(() => expect(within(screen.getByRole('banner')).getByText('The Bells')).toBeVisible());
    expect(editor.getHTML()).toContain('Unsaved words typed here');
    // The next save keeps both: the writer's text and the synced title.
    await act(async () => { fireEvent.keyDown(window, { key: 's', ctrlKey: true }); });
    await waitFor(() => expect(stored()[0].documents[0].content).toContain('Unsaved words typed here'));
    expect(stored()[0].documents[0].title).toBe('The Bells');
  });

  it('saves the open chapter before loading a held-back update, then shows the new text', async () => {
    const { api, editor, projectId, docId } = await openChapter('<p>Local edit before loading</p>');
    sync.status = {
      configured: true, platform: 'desktop', account: { id: 'a', email: '', name: '' }, state: 'idle', message: null,
      lastRound: null, deviceName: 'PC',
      projects: [{ projectId, state: 'synced', pending: 0, conflicts: [], staged: [docId], lastSync: null, error: null, notices: [] }],
    };
    const order: string[] = [];
    const save = vi.spyOn(api, 'saveDocument');
    save.mockImplementation(async (_pid, doc) => {
      order.push('save');
      writeStored((p) => { p[0].documents[0].content = doc.content; });
    });
    const apply = vi.spyOn(api, 'syncApplyStaged').mockImplementation(async () => {
      order.push('apply');
      writeStored((p) => { p[0].documents[0].content = '<p>Text from the phone</p>'; });
      return { changed: [`text:${docId}`], staged: [], published: 0, held: 0 };
    });
    const statusCall = vi.spyOn(api, 'syncStatus').mockResolvedValue(sync.status);
    // More typing re-renders the App with the new status (the update is staged for this chapter).
    act(() => { editor.commands.insertContent(' more'); });
    const load = await screen.findByRole('button', { name: 'Load it' });
    fireEvent.click(load);
    await waitFor(() => expect(apply).toHaveBeenCalledWith(projectId, docId));
    expect(order).toEqual(['save', 'apply']);
    await waitFor(() => expect(editor.getHTML()).toContain('Text from the phone'));
    save.mockRestore();
    apply.mockRestore();
    statusCall.mockRestore();
  });
});
