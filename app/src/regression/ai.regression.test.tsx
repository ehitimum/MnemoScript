import { beforeAll, describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
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
