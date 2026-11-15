import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import BackupSettings from '../components/sync/BackupSettings';
import type { BackupCreated, BackupInfo } from '../lib/backupTypes';

const state = vi.hoisted(() => ({ native: true, saveCopy: vi.fn(), list: vi.fn(), remove: vi.fn() }));
vi.mock('../lib/platform', () => ({ get isTauri() { return state.native; } }));
vi.mock('../lib/api', () => ({ api: { saveBackupCopy: state.saveCopy, listBackups: state.list, deleteBackup: state.remove } }));

const backup = (over: Partial<BackupInfo> = {}): BackupInfo => ({
  path: 'C:/data/backups/Novel-2026-11-15-1200.zip', fileName: 'Novel-2026-11-15-1200.zip', projectId: 'p1',
  projectName: 'Novel', size: 2_400_000, createdAt: '2026-11-15T12:00:00Z', ...over,
});
const created = (warnings: string[] = []): BackupCreated => ({ path: backup().path, fileName: backup().fileName, warnings });

beforeEach(() => {
  state.native = true;
  state.saveCopy.mockReset();
  state.remove.mockReset().mockResolvedValue(undefined);
  state.list.mockReset().mockResolvedValue([]);
});

function setup(variant: 'desktop' | 'mobile' = 'desktop', projectName: string | undefined = 'Novel') {
  const onBackup = vi.fn(async () => created());
  const onRestore = vi.fn<() => Promise<boolean>>().mockResolvedValue(true);
  render(<BackupSettings variant={variant} projectName={projectName} projectId={projectName ? 'p1' : undefined} onBackup={onBackup} onRestore={onRestore} />);
  return { onBackup, onRestore };
}

describe('Project backup recovery UX (regression)', () => {
  it.each(['desktop', 'mobile'] as const)('creates a backup on the %s surface, lists it and saves a copy', async (variant) => {
    const { onBackup } = setup(variant);
    expect(screen.getByText(/unencrypted/)).toBeVisible();
    state.list.mockResolvedValue([backup()]);
    fireEvent.click(screen.getByRole('button', { name: 'Create backup' }));
    expect(screen.getByRole('button', { name: 'Restore backup' })).toBeDisabled();
    expect(await screen.findByText(/Backup saved on this device as Novel-2026-11-15-1200\.zip/)).toBeVisible();
    expect(onBackup).toHaveBeenCalledOnce();
    const list = await screen.findByRole('list', { name: 'Backups on this device' });
    expect(within(list).getByText(/2\.4 MB/)).toBeVisible();
    state.saveCopy.mockResolvedValueOnce(null);
    fireEvent.click(screen.getByRole('button', { name: /Save a copy of Novel-2026/ }));
    expect(await screen.findByText(/Save cancelled.*still on this device/)).toBeVisible();
    state.saveCopy.mockResolvedValueOnce('D:/safe/novel.zip');
    fireEvent.click(screen.getByRole('button', { name: /Save a copy of Novel-2026/ }));
    expect(await screen.findByText(/Backup copy saved: D:/)).toBeVisible();
    expect(state.saveCopy).toHaveBeenLastCalledWith(backup().path, backup().fileName);
  });

  it('keeps restore available with no selected project', () => {
    render(<BackupSettings variant="mobile" onBackup={vi.fn()} onRestore={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Create backup' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Restore backup' })).toBeEnabled();
  });

  it('gives browser users an accurate availability message', () => {
    state.native = false;
    setup();
    expect(screen.getByText(/available in the installed app/)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Create backup' })).toBeNull();
  });

  // PR #3 review item 4: the archive is no longer read into the web view; the picker hands its
  // location to the backend. Cancelling the picker is not an error and says nothing.
  it('restores through the file picker and stays quiet when it is cancelled', async () => {
    const { onRestore } = setup('mobile');
    onRestore.mockResolvedValueOnce(false);
    fireEvent.click(screen.getByRole('button', { name: 'Restore backup' }));
    await waitFor(() => expect(onRestore).toHaveBeenCalledOnce());
    expect(screen.queryByText(/restored as a separate project/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Restore backup' }));
    expect(await screen.findByText(/restored as a separate project/)).toBeVisible();
    expect(screen.getByText(/brings its AI conversations back but not the AI connection/)).toBeVisible();
  });

  it('shows checksum/save failures and permits retry without success messaging', async () => {
    const { onBackup, onRestore } = setup();
    onRestore.mockRejectedValueOnce(new Error('Backup checksum mismatch'));
    fireEvent.click(screen.getByRole('button', { name: 'Restore backup' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('checksum mismatch');
    expect(screen.queryByText(/restored as a separate project/)).toBeNull();
    onBackup.mockRejectedValueOnce(new Error('Disk full'));
    fireEvent.click(screen.getByRole('button', { name: 'Create backup' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Disk full');
    fireEvent.click(screen.getByRole('button', { name: 'Create backup' }));
    expect(await screen.findByText(/Backup saved on this device/)).toBeVisible();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('prevents duplicate backup requests while one is pending', async () => {
    let finish!: (c: BackupCreated) => void;
    const onBackup = vi.fn(() => new Promise<BackupCreated>((resolve) => { finish = resolve; }));
    render(<BackupSettings variant="desktop" projectName="Novel" onBackup={onBackup} onRestore={vi.fn()} />);
    const button = screen.getByRole('button', { name: 'Create backup' });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(onBackup).toHaveBeenCalledOnce();
    await act(async () => finish(created()));
    expect(await screen.findByText(/Backup saved on this device/)).toBeVisible();
  });

  // PR #3 review item 1: problems no longer block the backup; the writer sees what was left out.
  it('lists what a completed backup could not include', async () => {
    const { onBackup } = setup();
    onBackup.mockResolvedValueOnce(created(['chapter-9.json could not be read and was copied as it is.', '2 images outside this project were not included.']));
    fireEvent.click(screen.getByRole('button', { name: 'Create backup' }));
    expect(await screen.findByText(/The backup is complete, with 2 notes/)).toBeVisible();
    expect(screen.getByText(/chapter-9\.json could not be read/)).toBeVisible();
    expect(screen.getByText(/2 images outside this project/)).toBeVisible();
  });

  // PR #3 review item 3: backups were invisible and piled up; they are listed and can be deleted.
  it('deletes a backup only after confirming, and lists only this project with a count of others', async () => {
    state.list.mockResolvedValue([backup(), backup({ path: 'C:/data/backups/Salt-2026.zip', fileName: 'Salt-2026.zip', projectId: 'p2', projectName: 'Salt' })]);
    setup();
    const list = await screen.findByRole('list', { name: 'Backups on this device' });
    expect(within(list).queryByText(/Salt-2026/)).toBeNull();
    expect(screen.getByText(/1 backup belongs to other projects/)).toBeVisible();
    expect(screen.getByText(/newest 5 backups of each project are kept/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: /Delete Novel-2026/ }));
    const confirm = screen.getByRole('group', { name: /Confirm deleting Novel-2026/ });
    fireEvent.click(within(confirm).getByRole('button', { name: 'Keep' }));
    expect(state.remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Delete Novel-2026/ }));
    state.list.mockResolvedValue([]);
    fireEvent.click(within(screen.getByRole('group', { name: /Confirm deleting/ })).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(state.remove).toHaveBeenCalledWith(backup().path));
    expect(await screen.findByText('Backup deleted.')).toBeVisible();
    await waitFor(() => expect(screen.queryByRole('list', { name: 'Backups on this device' })).toBeNull());
  });
});
