/**
 * Browser-only preview of the sync UI (`?syncMock=1`), so the settings card, status pill,
 * banner and conflict review can be designed without a Google account. Never used in the
 * installed apps, which always talk to the Rust backend.
 */
import type { ConflictVersion, RemoteProject, SyncStatus } from './types';

export function syncMockEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    if (new URLSearchParams(window.location.search).has('syncMock')) {
      window.localStorage.setItem('mnemo_sync_mock', '1');
    }
    return window.localStorage.getItem('mnemo_sync_mock') === '1';
  } catch {
    return false;
  }
}

const state: { signedIn: boolean; enabled: Set<string>; conflictDoc: string | null } = {
  signedIn: true,
  enabled: new Set(),
  conflictDoc: null,
};

export function mockSync(cmd: string, args: Record<string, unknown>, projects: { id: string; documents?: { id: string; title: string }[] }[]): unknown {
  const first = projects[0];
  if (state.enabled.size === 0 && first) {
    state.enabled.add(first.id);
    state.conflictDoc = first.documents?.[0]?.id ?? null;
  }
  const status = (): SyncStatus => ({
    configured: true,
    platform: 'desktop',
    account: state.signedIn ? { id: 'mock', email: 'writer@example.com', name: 'A. Writer' } : null,
    state: state.signedIn ? 'idle' : 'signed-out',
    message: null,
    lastRound: new Date().toISOString(),
    deviceName: 'WRITING-PC',
    projects: state.signedIn
      ? projects
          .filter((p) => state.enabled.has(p.id))
          .map((p) => {
            const doc = p.documents?.find((d) => d.id === state.conflictDoc);
            return {
              projectId: p.id,
              state: doc ? 'conflict' : 'synced',
              pending: 0,
              conflicts: doc ? [{ docId: doc.id, title: doc.title }] : [],
              staged: [],
              lastSync: new Date(Date.now() - 4 * 60_000).toISOString(),
              error: null,
              notices: doc ? [{ id: 1, kind: 'merged', detail: '"Volume 1" was renamed on two devices; one name was kept', createdAt: new Date().toISOString() }] : [],
            };
          })
      : [],
  });
  switch (cmd) {
    case 'sync_status':
      return status();
    case 'drive_sign_in':
      state.signedIn = true;
      return status();
    case 'drive_sign_out':
      state.signedIn = false;
      return status();
    case 'sync_enable_project':
      state.enabled.add(String(args.projectId));
      return status();
    case 'sync_disable_project':
      state.enabled.delete(String(args.projectId));
      return status();
    case 'drive_remote_projects':
      return [
        { projectId: 'remote-1', name: 'Salt & Lantern', deviceName: 'Pixel 8', updatedAt: new Date(Date.now() - 86_400_000).toISOString(), local: false, syncing: false },
      ] satisfies RemoteProject[];
    case 'sync_conflict':
      return [
        { rev: 'local', local: true, device: 'WRITING-PC', content: '<p>The bells rang at dawn, and nobody in Ashford slept again.</p><p>Mara counted them anyway.</p>' },
        { rev: 'phone', local: false, device: 'Pixel 8', content: '<p>The bells rang at dawn.</p><p>Mara counted each one, as her mother had taught her, and stopped at nine.</p>' },
      ] satisfies ConflictVersion[];
    case 'sync_resolve_conflict':
      state.conflictDoc = null;
      return [];
    case 'sync_dismiss_notice':
    case 'sync_now':
    case 'sync_set_active':
    case 'drive_cancel_sign_in':
      return undefined;
    default:
      throw new Error('Not available in the sync preview.');
  }
}
