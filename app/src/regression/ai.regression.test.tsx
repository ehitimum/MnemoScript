import { beforeAll, describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import type { Editor as TiptapEditor } from '@tiptap/react';
import type { AiSession } from '../lib/ai/types';

/**
 * AI assistant UI, mounted in the real App (browser fallback backend). `mnemoscript:aimock`
 * switches on the dev mock provider, which runs the real flow: tool call → frontend executes it →
 * streamed reply.
 */
async function loadApp(search = '') {
  vi.resetModules();
  window.history.replaceState({}, '', `/${search}`);
  return (await import('../App')).default;
}

// The first import of the whole App (TipTap, React Flow, …) is slow when every suite starts at
// once; warm Vite's transform cache here so a cold start can't time out the first test.
beforeAll(async () => {
  await import('../App');
}, 60000);

async function createProject(name: string, mobile = false) {
  if (mobile) {
    fireEvent.click(await screen.findByRole('button', { name: /new project/i }));
  } else {
    fireEvent.click((await screen.findByText(/start a novel/i)).closest('button')!);
  }
  const input = await screen.findByPlaceholderText(/ashen crown/i);
  fireEvent.change(input, { target: { value: name } });
  fireEvent.submit(input.closest('form')!);
}

const aiPanel = () => document.querySelector('aside[aria-label="AI assistant"]') as HTMLElement | null;
const sessionsOf = (projectId: string) =>
  JSON.parse(localStorage.getItem(`mnemoscript:ai-sessions:${projectId}`) || '[]') as AiSession[];
const projectIds = () => (JSON.parse(localStorage.getItem('mnemoscript:projects') || '[]') as { id: string; name: string }[]);

describe('AI assistant — desktop panel (regression)', () => {
  it('opens with Ctrl+L and asks to connect when no AI is ready', async () => {
    const App = await loadApp();
    render(<App />);
    await createProject('Novel');
    await screen.findByText(/no documents yet/i);
    fireEvent.keyDown(window, { key: 'l', ctrlKey: true });
    await waitFor(() => expect(aiPanel()).toBeTruthy());
    expect(await within(aiPanel()!).findByText(/connect an ai/i)).toBeInTheDocument();
    expect(within(aiPanel()!).getByText('Claude (your subscription)')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'l', ctrlKey: true });
    await waitFor(() => expect(aiPanel()).toBeNull());
  });

  it('runs a turn end to end, saves the session in this project only, and records the model', async () => {
    localStorage.setItem('mnemoscript:aimock', '1');
    const App = await loadApp();
    render(<App />);
    await createProject('Ember');
    await screen.findByText(/no documents yet/i);
    fireEvent.click(screen.getByRole('button', { name: /^ai$/i }));
    const panel = await waitFor(() => aiPanel()!);
    const box = await within(panel).findByPlaceholderText(/ask about your story/i);
    fireEvent.change(box, { target: { value: 'What is in this project?' } });
    fireEvent.keyDown(box, { key: 'Enter' });

    expect(await within(panel).findByText(/want me to draft the change/i, {}, { timeout: 6000 })).toBeInTheDocument();
    expect(within(panel).getByText('Looked through the project')).toBeInTheDocument();
    expect(within(panel).getByText('Claude Sonnet 5')).toBeInTheDocument();

    const [project] = projectIds();
    await waitFor(() => expect(sessionsOf(project.id)[0]?.models).toEqual(['claude-sonnet-5']));
    expect(sessionsOf(project.id)[0].title).toBe('What is in this project?');
    // The connection is remembered on the project itself.
    const stored = JSON.parse(localStorage.getItem('mnemoscript:projects')!)[0];
    expect(stored.ai).toEqual({ provider: 'claude-code', model: '', mode: 'ask' });
  }, 15000);
});

function liveEditor(): TiptapEditor {
  const pm = document.querySelector('.ProseMirror') as (HTMLElement & { editor?: TiptapEditor }) | null;
  if (!pm?.editor) throw new Error('editor not mounted');
  return pm.editor;
}

describe('AI assistant — edits (regression)', () => {
  it('ask mode: proposes a change, applies it to the open chapter on Apply, and Undo restores it', async () => {
    localStorage.setItem('mnemoscript:aimock', '1');
    const App = await loadApp();
    render(<App />);
    await createProject('Edits');
    await screen.findByText(/no documents yet/i);
    fireEvent.click(screen.getByRole('button', { name: /new chapter/i }));
    await waitFor(() => expect(document.querySelector('.ProseMirror')).toBeTruthy());
    liveEditor().commands.setContent('<p>The tavern roared and <strong>Mara</strong> slipped through the crowd.</p>', { emitUpdate: true });

    fireEvent.click(screen.getByRole('button', { name: /^ai$/i }));
    const panel = await waitFor(() => aiPanel()!);
    expect(within(panel).getByRole('radio', { name: /ask/i })).toHaveAttribute('aria-checked', 'true');
    const box = await within(panel).findByPlaceholderText(/ask about your story/i);
    fireEvent.change(box, { target: { value: 'Please polish the opening' } });
    fireEvent.keyDown(box, { key: 'Enter' });

    // The proposal waits; nothing is written until the writer applies it.
    const apply = await within(panel).findByRole('button', { name: /^apply$/i }, { timeout: 6000 });
    expect(within(panel).getByText('Needs your OK')).toBeInTheDocument();
    expect(within(panel).getByText(/waiting for you to apply or reject/i)).toBeInTheDocument();
    expect(liveEditor().getText()).not.toContain('sharpened');
    fireEvent.click(apply);

    await within(panel).findByText(/done \(mock\)/i, {}, { timeout: 6000 });
    expect(within(panel).getByText('Applied')).toBeInTheDocument();
    await waitFor(() => expect(liveEditor().getText()).toContain('The tavern roared and Mara slipped — sharpened through the crowd.'));
    expect(liveEditor().getHTML()).toContain('<strong>Mara</strong>'); // formatting outside the edit survives
    // The status bar recounts after content applied from outside the editor (was stale).
    const wordsShown = () => [...document.querySelectorAll('strong')].find((el) => el.parentElement?.textContent?.trim() === `${el.textContent} words`)?.textContent;
    await waitFor(() => expect(wordsShown()).toBe('11'));
    const [project] = projectIds();
    await waitFor(() => expect(sessionsOf(project.id)[0]?.messages[1].toolCalls?.at(-1)?.change?.status).toBe('applied'));

    fireEvent.click(within(panel).getByRole('button', { name: /^undo$/i }));
    await waitFor(() => expect(liveEditor().getText()).toBe('The tavern roared and Mara slipped through the crowd.'));
    expect(within(panel).getByText('Undone')).toBeInTheDocument();
    await waitFor(() => expect(sessionsOf(project.id)[0]?.messages[1].toolCalls?.at(-1)?.change?.status).toBe('undone'));
  }, 20000);

  it('plan mode offers no edits: the mock answers in prose and nothing changes', async () => {
    localStorage.setItem('mnemoscript:aimock', '1');
    const App = await loadApp();
    render(<App />);
    await createProject('Planning');
    await screen.findByText(/no documents yet/i);
    fireEvent.click(screen.getByRole('button', { name: /new chapter/i }));
    await waitFor(() => expect(document.querySelector('.ProseMirror')).toBeTruthy());
    liveEditor().commands.setContent('<p>The tavern roared and the crowd surged.</p>', { emitUpdate: true });
    fireEvent.click(screen.getByRole('button', { name: /^ai$/i }));
    const panel = await waitFor(() => aiPanel()!);
    fireEvent.click(within(panel).getByRole('radio', { name: /plan/i }));
    const box = await within(panel).findByPlaceholderText(/ask about your story/i);
    fireEvent.change(box, { target: { value: 'fix the opening' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(await within(panel).findByText(/want me to draft the change/i, {}, { timeout: 6000 })).toBeInTheDocument();
    expect(within(panel).queryByRole('button', { name: /^apply$/i })).toBeNull();
    expect(liveEditor().getText()).toBe('The tavern roared and the crowd surged.');
  }, 20000);
});

describe('AI assistant — inline commands (regression)', () => {
  it('/polish from the slash menu previews the revision, Accept applies it (formatting kept), Ctrl+Z restores', async () => {
    localStorage.setItem('mnemoscript:aimock', '1');
    const App = await loadApp();
    render(<App />);
    await createProject('Inline');
    await screen.findByText(/no documents yet/i);
    fireEvent.click(screen.getByRole('button', { name: /new chapter/i }));
    await waitFor(() => expect(document.querySelector('.ProseMirror')).toBeTruthy());
    const ed = liveEditor();
    ed.commands.setContent('<p>The tavern was very loud and <strong>Mara</strong> slipped through the crowd.</p>', { emitUpdate: true });
    ed.chain().focus().setTextSelection(ed.state.doc.content.size - 1).insertContent(' /polish').run();

    // The slash menu lists the AI commands under their own label.
    const popup = await waitFor(() => {
      const el = document.querySelector('.slash-popup') as HTMLElement | null;
      if (!el) throw new Error('slash menu not open');
      return el;
    });
    expect(within(popup).getByText('AI')).toBeInTheDocument();
    expect(within(popup).getByText('Polish')).toBeInTheDocument();
    fireEvent.keyDown(document.querySelector('.ProseMirror')!, { key: 'Enter' });

    const card = await screen.findByRole('dialog', { name: /ai polish/i }, { timeout: 6000 });
    const accept = await within(card).findByRole('button', { name: /accept/i }, { timeout: 6000 });
    expect(document.querySelector('.mn-ai-target')).toBeTruthy(); // the passage is highlighted
    expect(ed.getText()).toContain('very loud'); // nothing changed yet
    fireEvent.click(accept);

    await waitFor(() => expect(ed.getText()).toBe('The tavern was loud, and Mara slipped through the crowd.'));
    expect(ed.getHTML()).toContain('<strong>Mara</strong>');
    expect(screen.queryByRole('dialog', { name: /ai polish/i })).toBeNull();
    expect(document.querySelector('.mn-ai-target')).toBeNull();
    ed.commands.undo();
    expect(ed.getText()).toBe('The tavern was very loud and Mara slipped through the crowd. ');
    // Inline commands are not chat messages.
    const [project] = projectIds();
    expect(sessionsOf(project.id)).toEqual([]);
  }, 20000);
});

describe('AI assistant — settings (regression)', () => {
  it('desktop Settings shows the Claude account, plan limit bars and API key status', async () => {
    localStorage.setItem('mnemoscript:aimock', '1');
    const App = await loadApp();
    render(<App />);
    fireEvent.click((await screen.findByText('Settings', { selector: 'h3, span, p, div' })).closest('button')!);
    expect(await screen.findByText('writer@example.com', {}, { timeout: 6000 })).toBeInTheDocument();
    expect(screen.getByText('Pro plan')).toBeInTheDocument();
    const bars = await screen.findAllByRole('progressbar');
    expect(bars.map((b) => [b.getAttribute('aria-label'), b.getAttribute('aria-valuenow')])).toEqual([
      ['Current session used', '42'],
      ['This week · all models used', '78'],
      ['This week · Fable used', '93'],
    ]);
    expect(screen.getByText(/5-hour window · resets Nov 12, 4pm/)).toBeInTheDocument();
    // Default mode for new projects is a setting.
    fireEvent.click(screen.getByRole('radio', { name: /plan/i }));
    expect(localStorage.getItem('mnemo_ai_mode')).toBe('plan');
  }, 15000);

  it('phone Settings has keys and defaults but no Claude Code card', async () => {
    localStorage.setItem('mnemoscript:aimock', '1');
    const App = await loadApp('?shell=mobile');
    render(<App />);
    fireEvent.click(within(document.querySelector('.mn-tabbar') as HTMLElement).getByText('Settings'));
    expect(await screen.findByText(/api keys/i)).toBeInTheDocument();
    expect(screen.getByText(/default mode for new projects/i)).toBeInTheDocument();
    expect(screen.queryByText(/claude subscription/i)).toBeNull();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });
});

describe('AI assistant — phone shell (regression)', () => {
  it('adds an AI tab that needs a project, and hides the tab bar while typing', async () => {
    localStorage.setItem('mnemoscript:aimock', '1');
    const App = await loadApp('?shell=mobile');
    render(<App />);
    const tabBar = () => document.querySelector('.mn-tabbar') as HTMLElement | null;
    const tabs = within(tabBar()!).getAllByRole('button');
    expect(tabs.map((t) => t.textContent?.trim())).toEqual(['Library', 'Write', 'AI', 'Tools', 'Settings']);
    expect(within(tabBar()!).getByText('AI').closest('button')).toBeDisabled();

    await createProject('Phone Novel', true);
    await waitFor(() => expect(within(tabBar()!).getByText('AI').closest('button')).not.toBeDisabled());
    fireEvent.click(within(tabBar()!).getByText('AI'));

    const box = await screen.findByPlaceholderText(/ask about your story/i);
    // Phones only offer API-key providers (no CLI on Android).
    expect(screen.getByText('Claude Opus 5.5')).toBeInTheDocument();
    fireEvent.focus(box);
    expect(tabBar()).toBeNull();
    fireEvent.blur(box);
    expect(tabBar()).toBeTruthy();
  });
});
