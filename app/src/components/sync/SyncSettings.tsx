import { useRef, useState, type ReactNode } from 'react';
import { Cloud, CloudOff, Download, Loader2, LogOut, RefreshCw, ShieldCheck, X } from 'lucide-react';
import { api } from '../../lib/api';
import { describe, projectSync } from '../../lib/sync/useSync';
import type { RemoteProject, SyncStatus } from '../../lib/sync/types';
import type { Project } from '../../types';
import SyncDot from './SyncDot';

export interface SyncSettingsProps {
  status: SyncStatus;
  setStatus: (s: SyncStatus) => void;
  projects: Project[];
  currentProjectId?: string;
  /** A project was downloaded from Drive: add it to the library (and offer to open it). */
  onDownloaded: (project: Project) => void;
  /** Android only: run Google's native authorization prompt and return an access token. */
  authorizeNative?: () => Promise<{ token: string; expiresIn: number }>;
}

function when(iso: string | null): string {
  if (!iso) return 'not yet';
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(iso).toLocaleDateString();
}

/**
 * Google Drive sync settings. Same component for both shells; `variant` only changes density.
 * Sync is optional and per project: nothing leaves the device until the writer turns it on.
 */
export default function SyncSettings({ variant, status, setStatus, projects, currentProjectId, onDownloaded, authorizeNative }: SyncSettingsProps & {
  variant: 'desktop' | 'mobile';
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [remote, setRemote] = useState<RemoteProject[] | null>(null);
  const inFlight = useRef(false);
  const desktop = variant === 'desktop';

  async function run(key: string, action: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(key);
    setError('');
    try { await action(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { inFlight.current = false; setBusy(null); }
  }

  const connect = () => run('connect', async () => {
    if (authorizeNative) {
      const { token, expiresIn } = await authorizeNative();
      setStatus(await api.driveSetAccessToken(token, expiresIn));
    } else {
      setStatus(await api.driveSignIn());
    }
  });

  const button = desktop
    ? 'inline-flex items-center justify-center gap-2 px-3.5 py-2 rounded-lg border border-border/40 bg-secondary/40 text-sm hover:border-primary/50 disabled:opacity-50 cursor-pointer transition-all'
    : 'mn-row justify-center gap-2 min-h-11 disabled:opacity-50';
  const primary = desktop
    ? 'inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium shadow-sm hover:opacity-90 disabled:opacity-60 cursor-pointer transition-all'
    : 'mn-btn mn-btn-primary justify-center gap-2 min-h-11 disabled:opacity-60';
  const label = 'text-3xs font-semibold tracking-[0.12em] text-muted-foreground/70 uppercase';

  const intro = (
    <p className="text-sm text-muted-foreground leading-relaxed">
      Keep projects in step across your computer and phone through your own Google Drive. MnemoScript only uses its own
      hidden app folder there: it can't see your other files, and there is no MnemoScript server in between.
    </p>
  );

  let body: ReactNode;
  if (status.state === 'unsupported') {
    body = <p className="text-sm text-muted-foreground leading-relaxed">Google Drive sync is available in the MnemoScript desktop and Android apps.</p>;
  } else if (status.state === 'unconfigured') {
    body = (
      <>
        {intro}
        <p className="text-xs text-muted-foreground">This build has no Google sign-in set up yet. Add an OAuth client to <code className="font-mono">app/src-tauri/.env.local</code> and rebuild.</p>
      </>
    );
  } else if (!status.account) {
    body = (
      <>
        {intro}
        <ul className="text-xs text-muted-foreground flex flex-col gap-1.5">
          <li className="flex gap-2"><ShieldCheck className="w-3.5 h-3.5 mt-0.5 text-primary shrink-0" />You sign in on Google's own page. Your password never passes through MnemoScript.</li>
          <li className="flex gap-2"><ShieldCheck className="w-3.5 h-3.5 mt-0.5 text-primary shrink-0" />Writing is saved on this device first and always works offline.</li>
          <li className="flex gap-2"><ShieldCheck className="w-3.5 h-3.5 mt-0.5 text-primary shrink-0" />Drive stores projects in your account, protected in transit but not end-to-end encrypted. Sync is not a backup: keep project backups too.</li>
        </ul>
        <div className="flex flex-wrap gap-2 items-center">
          <button className={primary} disabled={!!busy} onClick={connect}>
            {busy === 'connect' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Cloud className="w-4 h-4" />}
            {busy === 'connect' ? (authorizeNative ? 'Waiting for Google…' : 'Finish signing in in your browser…') : 'Connect Google Drive'}
          </button>
          {busy === 'connect' && !authorizeNative && (
            <button className={button} onClick={() => void api.driveCancelSignIn()}><X className="w-4 h-4" />Cancel</button>
          )}
        </div>
      </>
    );
  } else {
    const account = status.account;
    const synced = new Set(status.projects.map((p) => p.projectId));
    const current = projectSync(status, currentProjectId);
    const headline =
      status.state === 'syncing' ? 'Syncing…'
      : status.state === 'offline' ? 'Offline. Changes are kept on this device and sent later.'
      : status.state === 'busy' ? 'Google Drive asked to slow down; retrying shortly.'
      : status.state === 'needs-auth' ? 'Google sign-in expired. Reconnect to keep syncing.'
      : status.state === 'error' ? (status.message ?? 'Sync paused')
      : `Up to date · checked ${when(status.lastRound)}`;
    body = (
      <>
        <div className={`flex items-center gap-3 ${desktop ? 'p-3 rounded-xl bg-secondary/30 border border-border/30' : 'mn-row'}`}>
          <div className="w-9 h-9 rounded-full bg-primary/12 text-primary flex items-center justify-center text-sm font-semibold shrink-0" aria-hidden>
            {(account.name || account.email || 'G').slice(0, 1).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm text-foreground truncate">{account.name || 'Google account'}</div>
            <div className="text-xs text-muted-foreground truncate">{account.email}</div>
          </div>
          <button className={`${button} ${desktop ? '' : 'w-auto px-3'}`} disabled={!!busy} title="Disconnect Google Drive on this device"
            onClick={() => run('signout', async () => setStatus(await api.driveSignOut()))}>
            <LogOut className="w-4 h-4" />{desktop && 'Disconnect'}
          </button>
        </div>

        <div className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
          {status.state === 'syncing' ? <RefreshCw className="w-3.5 h-3.5 animate-spin text-primary" />
            : status.state === 'offline' ? <CloudOff className="w-3.5 h-3.5" />
            : <Cloud className="w-3.5 h-3.5 text-primary" />}
          <span className="flex-1">{headline}</span>
          {status.state === 'needs-auth'
            ? <button className={button} disabled={!!busy} onClick={connect}>Reconnect</button>
            : <button className="text-primary hover:underline cursor-pointer disabled:opacity-50" disabled={!!busy} onClick={() => void api.syncNow()}>Sync now</button>}
        </div>

        <div className="flex flex-col gap-2">
          <h4 className={label}>Projects on this device</h4>
          {projects.length === 0 && <p className="text-xs text-muted-foreground">No projects yet.</p>}
          <ul className="flex flex-col divide-y divide-border/30 rounded-xl border border-border/30 overflow-hidden">
            {projects.map((p) => {
              const ps = projectSync(status, p.id);
              const d = describe(status, ps);
              const on = synced.has(p.id);
              return (
                <li key={p.id} className="flex items-center gap-3 px-3 py-2.5 bg-card/30">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-foreground truncate">{p.name}</div>
                    <div className="text-3xs text-muted-foreground flex items-center gap-1.5">
                      {on ? <><SyncDot tone={d.tone} />{d.label}{ps?.lastSync && ps.state === 'synced' ? ` · ${when(ps.lastSync)}` : ''}</> : 'Only on this device'}
                    </div>
                    {on && ps?.error && ps.state !== 'synced' && <div className="text-3xs text-destructive/90 break-words">{ps.error}</div>}
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer shrink-0" title={on ? 'Stop syncing this project' : 'Sync this project with Google Drive'}>
                    <input type="checkbox" className="sr-only peer" checked={on} disabled={!!busy} aria-label={`Sync ${p.name}`}
                      onChange={() => run(`p:${p.id}`, async () => setStatus(on ? await api.syncDisableProject(p.id) : await api.syncEnableProject(p.id)))} />
                    <span className="w-9 h-5 rounded-full bg-secondary border border-border/50 peer-checked:bg-primary/80 peer-checked:border-primary transition-colors" />
                    <span className="absolute left-0.5 top-0.5 w-4 h-4 rounded-full bg-background shadow-sm transition-transform peer-checked:translate-x-4" />
                  </label>
                </li>
              );
            })}
          </ul>
          <p className="text-3xs text-muted-foreground/80">Turning sync off keeps every file here and on Drive; turning it back on resumes without duplicates.</p>
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <h4 className={label}>On Google Drive</h4>
            <button className="text-xs text-primary hover:underline cursor-pointer disabled:opacity-50" disabled={!!busy}
              onClick={() => run('remote', async () => setRemote(await api.driveRemoteProjects()))}>
              {busy === 'remote' ? 'Looking…' : remote ? 'Refresh' : 'Find projects from other devices'}
            </button>
          </div>
          {remote && remote.filter((r) => !r.local).length === 0 && (
            <p className="text-xs text-muted-foreground">Every synced project is already on this device.</p>
          )}
          {remote && remote.filter((r) => !r.local).map((r) => {
            const sameName = projects.some((p) => p.name.trim().toLowerCase() === r.name.trim().toLowerCase());
            return (
              <div key={r.projectId} className={`flex items-center gap-3 ${desktop ? 'px-3 py-2.5 rounded-xl border border-border/30 bg-card/30' : 'mn-row'}`}>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-foreground truncate">{r.name}</div>
                  <div className="text-3xs text-muted-foreground">From {r.deviceName} · {when(r.updatedAt)}</div>
                  {sameName && (
                    <div className="text-3xs text-muted-foreground/90 mt-0.5">
                      A separate project with this name is already here. Downloading keeps both; nothing is merged automatically.
                    </div>
                  )}
                </div>
                <button className={`${button} ${desktop ? '' : 'w-auto px-3'}`} disabled={!!busy}
                  onClick={() => run(`dl:${r.projectId}`, async () => {
                    const project = await api.syncDownloadProject(r.projectId, r.name);
                    setRemote((list) => list?.map((x) => (x.projectId === r.projectId ? { ...x, local: true, syncing: true } : x)) ?? null);
                    onDownloaded(project);
                    setStatus(await api.syncStatus());
                  })}>
                  {busy === `dl:${r.projectId}` ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                  {desktop && 'Download'}
                </button>
              </div>
            );
          })}
        </div>

        {current && current.notices.length > 0 && (
          <div className="flex flex-col gap-2">
            <h4 className={label}>Recent sync notes</h4>
            {current.notices.slice(0, 5).map((n) => (
              <div key={n.id} className="flex items-start gap-2 text-xs text-muted-foreground">
                <span className="flex-1 leading-relaxed">{n.detail}</span>
                <button className="text-muted-foreground/60 hover:text-foreground cursor-pointer" aria-label="Dismiss note"
                  onClick={() => run(`n:${n.id}`, async () => { await api.syncDismissNotice(n.id); setStatus(await api.syncStatus()); })}>
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </>
    );
  }

  return (
    <section className={desktop
      ? 'bg-card/60 border border-border/40 rounded-2xl p-5 flex flex-col gap-4 shadow-xs md:col-span-2'
      : 'flex flex-col gap-3'} aria-label="Google Drive sync">
      <h3 className={`${label} flex items-center gap-1.5`}>
        <Cloud className="w-3.5 h-3.5 text-primary" />Sync with Google Drive
      </h3>
      {body}
      {error && <p role="alert" className="text-sm text-destructive break-words">{error}</p>}
    </section>
  );
}
