import { beforeAll, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { Editor } from '@tiptap/react';
import type { BackupActions } from '../components/sync/BackupSettings';

// Expose the App's backup boundary in a browser fixture; real native controls are tested separately.
vi.mock('../components/sync/BackupSettings', () => ({ default: ({ onBackup }: BackupActions) =>
  <button onClick={() => void onBackup().catch(() => {})}>Test backup boundary</button>,
}));

beforeAll(async () => { await import('../App'); }, 60000);

async function openDirtyChapter() {
  const { default: App } = await import('../App');
  const { api } = await import('../lib/api');
  render(<App />);
  fireEvent.click(screen.getByText(/start a novel/i).closest('button')!);
  const input = await screen.findByPlaceholderText(/ashen crown/i);
  fireEvent.change(input, { target: { value: 'Backup Novel' } });
  fireEvent.submit(input.closest('form')!);
  fireEvent.click(await screen.findByRole('button', { name: /new chapter/i }));
  await waitFor(() => expect(document.querySelector('.ProseMirror')).toBeTruthy());
  const editor = (document.querySelector('.ProseMirror') as HTMLElement & { editor: Editor }).editor;
  act(() => { editor.commands.setContent('<p>Unsaved manuscript for backup</p>', { emitUpdate: true }); });
  // The desktop Settings command is reachable without depending on toolbar icon placement.
  fireEvent.click(within(screen.getByRole('banner')).getByRole('button', { name: /Search commands/ }));
  fireEvent.change(await screen.findByPlaceholderText(/type a command/i), { target: { value: 'Settings' } });
  fireEvent.click(await screen.findByRole('button', { name: /Settings/i }));
  return api;
}

describe('Backup save boundary (regression)', () => {
  it('persists the latest chapter before requesting a snapshot', async () => {
    const api = await openDirtyChapter();
    const snapshots: string[] = [];
    const backup = vi.spyOn(api, 'backupProject').mockImplementation(async () => {
      snapshots.push(localStorage.getItem('mnemoscript:projects')!);
      return '/backup.zip';
    });
    fireEvent.click(screen.getByRole('button', { name: 'Test backup boundary' }));
    await waitFor(() => expect(backup).toHaveBeenCalledOnce());
    expect(JSON.parse(snapshots[0])[0].documents[0].content).toContain('Unsaved manuscript for backup');
    backup.mockRestore();
  });

  it('never produces a successful backup after a failed local save', async () => {
    const api = await openDirtyChapter();
    const save = vi.spyOn(api, 'saveDocument').mockRejectedValueOnce(new Error('Disk full'));
    const backup = vi.spyOn(api, 'backupProject').mockResolvedValue('/backup.zip');
    fireEvent.click(screen.getByRole('button', { name: 'Test backup boundary' }));
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(backup).not.toHaveBeenCalled();
    save.mockRestore();
    backup.mockRestore();
  });
});
