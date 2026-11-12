import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { isTauri } from '../platform';
import { syncMockEnabled } from './devMock';
import type { SyncAppliedEvent, SyncProjectStatus, SyncStatus } from './types';
import { UNSUPPORTED_STATUS } from './types';

/** Subscribe to a backend event (Tauri only). Returns an unsubscribe function. */
export function onSyncEvent<T>(name: 'sync://status' | 'sync://applied', handler: (payload: T) => void): () => void {
  if (!isTauri) return () => {};
  let unlisten: (() => void) | undefined;
  let cancelled = false;
  import('@tauri-apps/api/event')
    .then(({ listen }) => listen<T>(name, (e) => handler(e.payload)))
    .then((u) => {
      if (cancelled) u();
      else unlisten = u;
    })
    .catch(() => {});
  return () => {
    cancelled = true;
    unlisten?.();
  };
}

/** Live MnemoSync status for the whole app (initial fetch + backend pushes). */
export function useSyncStatus() {
  const [status, setStatus] = useState<SyncStatus>(UNSUPPORTED_STATUS);
  const refresh = useCallback(() => {
    if (!isTauri && !syncMockEnabled()) return;
    api.syncStatus().then(setStatus).catch(() => {});
  }, []);
  useEffect(() => {
    refresh();
    return onSyncEvent<SyncStatus>('sync://status', setStatus);
  }, [refresh]);
  return { status, setStatus, refresh };
}

/** Call `handler` when another device's changes were written into a project on this device. */
export function useSyncApplied(handler: (event: SyncAppliedEvent) => void) {
  useEffect(() => onSyncEvent<SyncAppliedEvent>('sync://applied', handler), [handler]);
}

export function projectSync(status: SyncStatus, projectId: string | undefined): SyncProjectStatus | undefined {
  return projectId ? status.projects.find((p) => p.projectId === projectId) : undefined;
}

/** Short, calm wording for the status pill and settings rows. */
export function describe(status: SyncStatus, project?: SyncProjectStatus): { label: string; tone: 'ok' | 'busy' | 'warn' | 'muted' } {
  if (status.state === 'needs-auth') return { label: 'Sign in to sync', tone: 'warn' };
  if (!project) return { label: 'Not synced', tone: 'muted' };
  switch (project.state) {
    case 'synced':
      return { label: 'Synced', tone: 'ok' };
    case 'syncing':
      return { label: 'Syncing…', tone: 'busy' };
    case 'pending':
      return { label: status.state === 'offline' ? 'Offline · saved here' : 'Waiting to sync', tone: 'busy' };
    case 'conflict':
      return { label: project.conflicts.length === 1 ? '1 chapter to review' : `${project.conflicts.length} chapters to review`, tone: 'warn' };
    case 'offline':
      return { label: 'Offline · saved here', tone: 'muted' };
    case 'needs-auth':
      return { label: 'Sign in to sync', tone: 'warn' };
    case 'account-mismatch':
      return { label: 'Different Google account', tone: 'warn' };
    default:
      return { label: 'Sync paused', tone: 'warn' };
  }
}
