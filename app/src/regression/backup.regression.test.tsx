import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import BackupSettings from '../components/sync/BackupSettings';

const state = vi.hoisted(() => ({ native: true, saveCopy: vi.fn() }));
vi.mock('../lib/platform', () => ({ get isTauri() { return state.native; } }));
vi.mock('../lib/api', () => ({ api: { saveBackupCopy: state.saveCopy } }));

beforeEach(() => { state.native = true; state.saveCopy.mockReset(); });

function setup(variant: 'desktop' | 'mobile' = 'desktop', projectName: string | undefined = 'Novel') {
  const onBackup = vi.fn(async () => 'C:/backups/novel.zip');
  const onRestore = vi.fn<(bytes: Uint8Array) => Promise<void>>().mockResolvedValue(undefined);
  render(<BackupSettings variant={variant} projectName={projectName} onBackup={onBackup} onRestore={onRestore} />);
  return { onBackup, onRestore };
}

function choose(bytes = [80, 75], size?: number) {
  const file = new File([new Uint8Array(bytes)], 'novel.zip', { type: 'application/zip' });
  Object.defineProperty(file, 'arrayBuffer', { value: async () => new Uint8Array(bytes).buffer });
  if (size) Object.defineProperty(file, 'size', { value: size });
  fireEvent.change(screen.getByLabelText('Choose project backup'), { target: { files: [file] } });
}

describe('Project backup recovery UX (regression)', () => {
  it.each(['desktop', 'mobile'] as const)('uses the %s settings surface and exposes progress and copy export', async (variant) => {
    const { onBackup } = setup(variant);
    expect(screen.getByText(/unencrypted/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Create backup' }));
    expect(screen.getByRole('button', { name: 'Restore backup' })).toBeDisabled();
    expect(await screen.findByText(/Backup created on this device/)).toBeVisible();
    expect(onBackup).toHaveBeenCalledOnce();
    state.saveCopy.mockResolvedValueOnce(null);
    fireEvent.click(screen.getByRole('button', { name: 'Save a copy…' }));
    expect(await screen.findByText(/Save cancelled.*still on this device/)).toBeVisible();
    state.saveCopy.mockResolvedValueOnce('D:/safe/novel.zip');
    fireEvent.click(screen.getByRole('button', { name: 'Save a copy…' }));
    expect(await screen.findByText(/Backup copy saved: D:/)).toBeVisible();
  });

  it('keeps restore available with no selected project', () => {
    const onBackup = vi.fn();
    render(<BackupSettings variant="mobile" onBackup={onBackup} onRestore={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Create backup' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Restore backup' })).toBeEnabled();
  });

  it('gives browser users an accurate availability message', () => {
    state.native = false;
    setup();
    expect(screen.getByText(/available in the installed app/)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Create backup' })).toBeNull();
  });

  it('restores raw bytes, reports a separate copy, and allows choosing the same file again', async () => {
    const { onRestore } = setup('mobile');
    choose();
    await waitFor(() => expect(onRestore).toHaveBeenCalledWith(new Uint8Array([80, 75])));
    expect(await screen.findByText(/restored as a separate project/)).toBeVisible();
    expect(screen.getByLabelText('Choose project backup')).toHaveValue('');
    choose();
    await waitFor(() => expect(onRestore).toHaveBeenCalledTimes(2));
  });

  it('rejects oversized files before reading or invoking restore', async () => {
    const { onRestore } = setup();
    choose([1], 600 * 1024 * 1024 + 1);
    expect(await screen.findByRole('alert')).toHaveTextContent('600 MiB');
    expect(onRestore).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Restore backup' })).toBeEnabled();
  });

  it('shows checksum/save failures and permits retry without success messaging', async () => {
    const { onBackup, onRestore } = setup();
    onRestore.mockRejectedValueOnce(new Error('Backup checksum mismatch'));
    choose();
    expect(await screen.findByRole('alert')).toHaveTextContent('checksum mismatch');
    expect(screen.queryByText(/restored as a separate project/)).toBeNull();
    onBackup.mockRejectedValueOnce(new Error('Disk full'));
    fireEvent.click(screen.getByRole('button', { name: 'Create backup' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Disk full');
    expect(screen.queryByRole('button', { name: 'Save a copy…' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Create backup' }));
    expect(await screen.findByText(/Backup created on this device/)).toBeVisible();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('prevents duplicate backup requests while one is pending', async () => {
    let finish!: (path: string) => void;
    const onBackup = vi.fn(() => new Promise<string>((resolve) => { finish = resolve; }));
    render(<BackupSettings variant="desktop" projectName="Novel" onBackup={onBackup} onRestore={vi.fn()} />);
    const button = screen.getByRole('button', { name: 'Create backup' });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(onBackup).toHaveBeenCalledOnce();
    await act(async () => finish('/backup.zip'));
    expect(await screen.findByRole('button', { name: 'Save a copy…' })).toBeEnabled();
  });
});
