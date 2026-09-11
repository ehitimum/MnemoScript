import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import type { Editor as TiptapEditor } from '@tiptap/react';
import type { Project } from '../types';

/** Import App fresh so `lib/platform` re-reads the URL (shell override). */
async function loadApp(search = '') {
  vi.resetModules();
  window.history.replaceState({}, '', `/${search}`);
  const mod = await import('../App');
  return mod.default;
}

function storedProjects(): Project[] {
  return JSON.parse(localStorage.getItem('mnemoscript:projects') || '[]') as Project[];
}

async function createProject(name: string) {
  fireEvent.click(screen.getByText(/start a novel/i).closest('button')!);
  const input = await screen.findByPlaceholderText(/ashen crown/i);
  fireEvent.change(input, { target: { value: name } });
  fireEvent.submit(input.closest('form')!);
  await screen.findByText(/no documents yet/i);
}

function liveEditor(): TiptapEditor {
  const pm = document.querySelector('.ProseMirror') as (HTMLElement & { editor?: TiptapEditor }) | null;
  if (!pm?.editor) throw new Error('editor not mounted');
  return pm.editor;
}

describe('App shell selection (regression)', () => {
  it('renders the desktop welcome screen in a desktop browser', async () => {
    const App = await loadApp();
    render(<App />);
    expect(await screen.findByText('MnemoScript Studio')).toBeInTheDocument();
    expect(document.querySelector('.mn-tabbar')).toBeNull();
  });

  it('renders the phone shell (bottom tabs) when forced with ?shell=mobile', async () => {
    const App = await loadApp('?shell=mobile');
    render(<App />);
    expect(await screen.findByText('Your Projects')).toBeInTheDocument();
    const tabs = within(document.querySelector('.mn-tabbar') as HTMLElement).getAllByRole('button');
    expect(tabs.map((t) => t.textContent?.trim())).toEqual(['Library', 'Write', 'Tools', 'Settings']);
  });
});

describe('App persistence (regression)', () => {
  it('creates a project and a chapter, and shows an empty state instead of a void editor', async () => {
    const App = await loadApp();
    render(<App />);
    await createProject('Test Novel');
    expect(screen.getByText(/pick a document to start writing/i)).toBeInTheDocument();
    expect(document.querySelector('.ProseMirror')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /new chapter/i }));
    await waitFor(() => expect(document.querySelector('.ProseMirror')).toBeTruthy());
    expect(storedProjects()[0].documents.map((d) => d.title)).toEqual(['Chapter 1']);
  });

  it('saves unsaved edits when switching to another document (flush-on-switch)', async () => {
    const App = await loadApp();
    render(<App />);
    await createProject('Flush Novel');
    fireEvent.click(screen.getByRole('button', { name: /new chapter/i }));
    await waitFor(() => expect(document.querySelector('.ProseMirror')).toBeTruthy());

    act(() => {
      liveEditor().commands.setContent('<h2>One</h2><p>Draft text that must survive</p>', { emitUpdate: true });
    });
    expect(screen.getByText(/unsaved changes/i)).toBeInTheDocument();

    // Create (and therefore switch to) a second chapter from the explorer.
    fireEvent.click(screen.getByTitle('Add…'));
    fireEvent.click(within(screen.getByRole('complementary')).getByText('New Chapter'));
    await waitFor(() => expect(screen.getByTitle('Chapter 2')).toBeInTheDocument());

    await waitFor(() => {
      const ch1 = storedProjects()[0].documents.find((d) => d.title === 'Chapter 1');
      expect(ch1?.content).toContain('Draft text that must survive');
    });
    expect(screen.getByText(/^saved$/i)).toBeInTheDocument();
  });

  it('routes a late canvas flush to the right document, not the newly selected one', async () => {
    const App = await loadApp();
    render(<App />);
    await createProject('Canvas Novel');

    // Mind map + one text chapter
    fireEvent.click(screen.getByTitle('Add…'));
    fireEvent.click(within(screen.getByRole('complementary')).getByText('New MindMap'));
    await waitFor(() => expect(screen.getByTitle('Add rectangle node')).toBeInTheDocument());
    fireEvent.click(screen.getByTitle('Add rectangle node')); // pending debounced edit

    // Switch away before the 400 ms debounce fires.
    fireEvent.click(screen.getByTitle('Add…'));
    fireEvent.click(within(screen.getByRole('complementary')).getByText('New Chapter'));
    await waitFor(() => expect(document.querySelector('.ProseMirror')).toBeTruthy());

    await waitFor(() => {
      const docs = storedProjects()[0].documents;
      const map = docs.find((d) => d.docType === 'mindmap')!;
      const chapter = docs.find((d) => d.docType === 'text')!;
      expect(JSON.parse(map.content).nodes).toHaveLength(1);
      expect(chapter.content).not.toContain('nodes');
    });
  });
});
