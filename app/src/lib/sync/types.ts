/** MnemoSync (Google Drive) shapes returned by the Rust backend (`src-tauri/src/sync/service.rs`). */

export type SyncGlobalState =
  | 'unsupported' // plain browser: sync lives in the installed apps
  | 'unconfigured' // this build has no Google OAuth client
  | 'signed-out'
  | 'needs-auth'
  | 'idle'
  | 'syncing'
  | 'offline'
  | 'busy'
  | 'error';

export type SyncProjectState =
  | 'synced'
  | 'pending'
  | 'syncing'
  | 'conflict'
  | 'offline'
  | 'needs-auth'
  | 'error'
  | 'account-mismatch';

export interface DriveAccount {
  id: string;
  email: string;
  name: string;
}

export interface SyncNotice {
  id: number;
  kind: 'deleted' | 'kept' | 'merged' | 'rejected' | string;
  detail: string;
  createdAt: string;
}

export interface SyncProjectStatus {
  projectId: string;
  state: SyncProjectState;
  /** Revisions saved here but not yet on Google Drive. */
  pending: number;
  conflicts: { docId: string; title: string }[];
  /** Open chapters with an update from another device waiting for the writer. */
  staged: string[];
  lastSync: string | null;
  error: string | null;
  notices: SyncNotice[];
}

export interface SyncStatus {
  configured: boolean;
  platform: 'desktop' | 'android' | 'ios' | 'web';
  account: DriveAccount | null;
  state: SyncGlobalState;
  message: string | null;
  lastRound: string | null;
  deviceName: string;
  projects: SyncProjectStatus[];
}

export interface RemoteProject {
  projectId: string;
  name: string;
  deviceName: string;
  updatedAt: string;
  /** The same project already exists on this device. */
  local: boolean;
  syncing: boolean;
}

export interface ConflictVersion {
  rev: string;
  /** The version currently in this device's chapter file. */
  local: boolean;
  device: string;
  content: string;
}

export interface SyncReport {
  changed: string[];
  staged: string[];
  published: number;
  held: number;
}

export interface SyncAppliedEvent {
  projectId: string;
  /** Entity keys, e.g. `doc:<id>`, `text:<id>`, `folder:<id>`, `project`. */
  changed: string[];
  staged: string[];
}

export const UNSUPPORTED_STATUS: SyncStatus = {
  configured: false,
  platform: 'web',
  account: null,
  state: 'unsupported',
  message: null,
  lastRound: null,
  deviceName: 'This browser',
  projects: [],
};
