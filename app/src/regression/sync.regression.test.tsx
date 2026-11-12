import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import SyncSettings from '../components/sync/SyncSettings';
import DocumentSyncBanner from '../components/sync/DocumentSyncBanner';
import ConflictReview from '../components/sync/ConflictReview';
import SyncPill from '../components/sync/SyncPill';
import { paragraphs } from '../lib/sync/preview';
import type { SyncStatus } from '../lib/sync/types';
import type { Project } from '../types';

const api = vi.hoisted(() => ({
  driveSignIn: vi.fn(),
  driveCancelSignIn: vi.fn(),
  driveSetAccessToken: vi.fn(),
  driveSignOut: vi.fn(),
  syncEnableProject: vi.fn(),
  syncDisableProject: vi.fn(),
  driveRemoteProjects: vi.fn(),
  syncDownloadProject: vi.fn(),
  syncStatus: vi.fn(),
  syncNow: vi.fn(),
  syncDismissNotice: vi.fn(),
  syncConflict: vi.fn(),
  syncResolveConflict: vi.fn(),
}));
vi.mock('../lib/api', () => ({ api }));

const project = (id: string, name: string): Project => ({ id, name, created_at: '2026-11-01', documents: [], folders: [] });
const projects = [project('p1', 'The Ashen Crown'), project('p2', 'Salt Notes')];

function status(over: Partial<SyncStatus> = {}): SyncStatus {
  return {
    configured: true,
    platform: 'desktop',
    account: { id: 'acct', email: 'writer@example.com', name: 'A. Writer' },
    state: 'idle',
    message: null,
    lastRound: new Date().toISOString(),
    deviceName: 'WRITING-PC',
    projects: [{ projectId: 'p1', state: 'synced', pending: 0, conflicts: [], staged: [], lastSync: new Date().toISOString(), error: null, notices: [] }],
    ...over,
  };
}

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
});

function settings(s: SyncStatus, extra: Partial<Parameters<typeof SyncSettings>[0]> = {}) {
  const setStatus = vi.fn();
  const onDownloaded = vi.fn();
  render(<SyncSettings variant="desktop" status={s} setStatus={setStatus} projects={projects} onDownloaded={onDownloaded} {...extra} />);
  return { setStatus, onDownloaded };
}

describe('Google Drive sync settings (regression)', () => {
  it('explains where sync lives in a plain browser and in builds without a Google client', () => {
    const { unmount } = render(<SyncSettings variant="mobile" status={status({ state: 'unsupported', account: null, projects: [] })} setStatus={vi.fn()} projects={[]} onDownloaded={vi.fn()} />);
    expect(screen.getByText(/available in the MnemoScript desktop and Android apps/)).toBeVisible();
    expect(screen.queryByRole('button', { name: /Connect Google Drive/ })).toBeNull();
    unmount();
    settings(status({ state: 'unconfigured', configured: false, account: null, projects: [] }));
    expect(screen.getByText(/no Google sign-in set up/)).toBeVisible();
  });

  it('signs in through the browser with a cancel option, and states the privacy limits first', async () => {
    let finish!: (s: SyncStatus) => void;
    api.driveSignIn.mockReturnValue(new Promise<SyncStatus>((r) => { finish = r; }));
    const { setStatus } = settings(status({ state: 'signed-out', account: null, projects: [] }));
    expect(screen.getByText(/not end-to-end encrypted/)).toBeVisible();
    expect(screen.getByText(/password never passes through MnemoScript/)).toBeVisible();
    const connect = screen.getByRole('button', { name: /Connect Google Drive/ });
    fireEvent.click(connect);
    fireEvent.click(connect);
    expect(api.driveSignIn).toHaveBeenCalledOnce();
    fireEvent.click(await screen.findByRole('button', { name: /Cancel/ }));
    expect(api.driveCancelSignIn).toHaveBeenCalledOnce();
    const signedIn = status();
    await act(async () => finish(signedIn));
    expect(setStatus).toHaveBeenCalledWith(signedIn);
  });

  it('uses the native Google prompt on Android and hands the token to the backend', async () => {
    const authorizeNative = vi.fn().mockResolvedValue({ token: 'ya29.token', expiresIn: 3599 });
    api.driveSetAccessToken.mockResolvedValue(status());
    settings(status({ state: 'signed-out', account: null, projects: [] }), { authorizeNative });
    fireEvent.click(screen.getByRole('button', { name: /Connect Google Drive/ }));
    await waitFor(() => expect(api.driveSetAccessToken).toHaveBeenCalledWith('ya29.token', 3599));
    expect(api.driveSignIn).not.toHaveBeenCalled();
  });

  it('turns sync on and off per project and shows each project state', async () => {
    api.syncEnableProject.mockResolvedValue(status());
    api.syncDisableProject.mockResolvedValue(status());
    settings(status({ projects: [{ projectId: 'p1', state: 'pending', pending: 3, conflicts: [], staged: [], lastSync: null, error: null, notices: [] }] }));
    expect(screen.getByText('Waiting to sync')).toBeVisible();
    expect(screen.getByText('Only on this device')).toBeVisible();
    fireEvent.click(screen.getByLabelText('Sync Salt Notes'));
    await waitFor(() => expect(api.syncEnableProject).toHaveBeenCalledWith('p2'));
    fireEvent.click(screen.getByLabelText('Sync The Ashen Crown'));
    await waitFor(() => expect(api.syncDisableProject).toHaveBeenCalledWith('p1'));
  });

  it('downloads a project from another device and never merges same-name projects silently', async () => {
    api.driveRemoteProjects.mockResolvedValue([
      { projectId: 'r1', name: 'the ashen crown', deviceName: 'Pixel 8', updatedAt: new Date().toISOString(), local: false, syncing: false },
      { projectId: 'p1', name: 'The Ashen Crown', deviceName: 'Laptop', updatedAt: new Date().toISOString(), local: true, syncing: true },
    ]);
    const downloaded = project('r1', 'the ashen crown');
    api.syncDownloadProject.mockResolvedValue(downloaded);
    api.syncStatus.mockResolvedValue(status());
    const { onDownloaded } = settings(status());
    fireEvent.click(screen.getByRole('button', { name: /Find projects from other devices/ }));
    expect(await screen.findByText(/From Pixel 8/)).toBeVisible();
    expect(screen.getByText(/Downloading keeps both; nothing is merged automatically/)).toBeVisible();
    expect(screen.queryByText(/From Laptop/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Download/ }));
    await waitFor(() => expect(onDownloaded).toHaveBeenCalledWith(downloaded));
    expect(api.syncDownloadProject).toHaveBeenCalledWith('r1', 'the ashen crown');
  });

  it('reports failures accessibly and offers reconnect when sign-in expired', async () => {
    api.driveSignIn.mockRejectedValueOnce(new Error('Google sign-in was cancelled'));
    settings(status({ state: 'needs-auth' }));
    expect(screen.getByText(/Google sign-in expired/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Reconnect' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('cancelled');
  });
});

describe('Open chapter sync banner (regression)', () => {
  it('offers to load a held-back update and reports a failed load', async () => {
    const onLoadUpdate = vi.fn().mockRejectedValueOnce(new Error('Disk full')).mockResolvedValue(undefined);
    const s = status({ projects: [{ ...status().projects[0], staged: ['ch1'] }] });
    render(<DocumentSyncBanner variant="desktop" status={s} projectId="p1" documentId="ch1" onLoadUpdate={onLoadUpdate} onReview={vi.fn()} />);
    expect(screen.getByText(/newer version of this chapter arrived/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Load it' }));
    expect(await screen.findByText('Disk full')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Load it' }));
    await waitFor(() => expect(onLoadUpdate).toHaveBeenCalledTimes(2));
  });

  it('sends parallel edits to review, and stays hidden for other chapters', () => {
    const onReview = vi.fn();
    const s = status({ projects: [{ ...status().projects[0], state: 'conflict', conflicts: [{ docId: 'ch3', title: 'Chapter 3' }] }] });
    const { rerender } = render(<DocumentSyncBanner variant="mobile" status={s} projectId="p1" documentId="ch3" onLoadUpdate={vi.fn()} onReview={onReview} />);
    expect(screen.getByText(/Both versions are safe/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Compare versions' }));
    expect(onReview).toHaveBeenCalledOnce();
    rerender(<DocumentSyncBanner variant="mobile" status={s} projectId="p1" documentId="ch1" onLoadUpdate={vi.fn()} onReview={onReview} />);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('keeps sync chrome away from local-only projects', () => {
    const { container } = render(<SyncPill status={status()} projectId="p2" onClick={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
    render(<SyncPill status={status()} projectId="p1" onClick={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Sync: Synced' })).toBeVisible();
  });
});

describe('Conflict review (regression)', () => {
  const versions = [
    { rev: 'r-local', local: true, device: 'WRITING-PC', content: '<p>The bells rang at dawn.</p><p>Desktop ending.</p>' },
    { rev: 'r-phone', local: false, device: 'Pixel 8', content: '<p>The bells rang at dawn.</p><p>Phone ending.</p><script>window.__pwned = true</script><img src="x" onerror="window.__pwned = true">' },
  ];

  it('shows both versions as plain text, marks differences, and keeps the other version by default', async () => {
    api.syncConflict.mockResolvedValue(versions);
    api.syncResolveConflict.mockResolvedValue(['copy-1']);
    const onResolved = vi.fn();
    render(<ConflictReview projectId="p1" documentId="ch3" title="Chapter 3" docType="text" variant="desktop" onClose={vi.fn()} onResolved={onResolved} />);
    const phone = (await screen.findByText('From Pixel 8')).closest('article')!;
    expect(within(phone).getByText('Phone ending.')).toHaveClass('bg-primary/10');
    expect(within(phone).getByText('The bells rang at dawn.')).not.toHaveClass('bg-primary/10');
    expect(document.querySelector('[role="dialog"] img, [role="dialog"] script')).toBeNull();
    expect((window as unknown as { __pwned?: boolean }).__pwned).toBeUndefined();
    fireEvent.click(within(phone).getByRole('button', { name: /Keep this/ }));
    await waitFor(() => expect(api.syncResolveConflict).toHaveBeenCalledWith('p1', 'ch3', 'r-phone', true));
    expect(onResolved).toHaveBeenCalledWith(['copy-1']);
  });

  it('can drop the copy, and surfaces a failed resolution', async () => {
    api.syncConflict.mockResolvedValue(versions);
    api.syncResolveConflict.mockRejectedValueOnce(new Error('That version is no longer part of the conflict'));
    render(<ConflictReview projectId="p1" documentId="ch3" title="Chapter 3" docType="text" variant="mobile" onClose={vi.fn()} onResolved={vi.fn()} />);
    fireEvent.click(await screen.findByRole('checkbox'));
    expect(screen.getByText(/stays in sync history/)).toBeVisible();
    fireEvent.click(within(screen.getByText('On this device').closest('article')!).getByRole('button', { name: /Keep this/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('no longer part');
    expect(api.syncResolveConflict).toHaveBeenCalledWith('p1', 'ch3', 'r-local', false);
  });

  it('summarises map versions instead of dumping JSON', () => {
    expect(paragraphs('{"nodes":[1,2],"edges":[1]}', 'mindmap')).toEqual(['2 ideas · 1 links']);
    expect(paragraphs('not json', 'fantasymap')).toEqual(['(This version could not be previewed)']);
    expect(paragraphs('<ul><li><p>One</p></li></ul><h2>Two</h2>', 'text')).toEqual(['One', 'Two']);
  });
});
