import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Archive, Download, Loader2, RotateCcw, Trash2 } from 'lucide-react';
import { api } from '../../lib/api';
import { isTauri } from '../../lib/platform';
import type { BackupCreated, BackupInfo } from '../../lib/backupTypes';

export interface BackupActions {
  projectName?: string;
  /** Lists this project's backups first; others stay reachable under "All projects". */
  projectId?: string;
  onBackup: () => Promise<BackupCreated>;
  /** Pick a backup file and restore it. `false` when the writer cancelled the picker. */
  onRestore: () => Promise<boolean>;
}

/** Most recent backups kept per project (older ones are removed when a new one is made). */
export const BACKUPS_KEPT = 5;

function size(bytes: number): string {
  if (bytes < 1_000_000) return `${Math.max(1, Math.round(bytes / 1000))} KB`;
  return `${(bytes / 1_000_000).toFixed(bytes < 10_000_000 ? 1 : 0)} MB`;
}

function when(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/** Recovery remains available without enabling sync or granting device access. */
export default function BackupSettings({ variant, projectName, projectId, onBackup, onRestore }: BackupActions & {
  variant: 'desktop' | 'mobile';
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [backups, setBackups] = useState<BackupInfo[] | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  // Ref closes the double-click window before React commits the disabled state.
  const inFlight = useRef(false);
  const desktop = variant === 'desktop';

  const refresh = useCallback(async () => {
    if (!isTauri) return;
    try {
      const list = await api.listBackups();
      setBackups(Array.isArray(list) ? list : []);
    } catch {
      setBackups([]);
    }
  }, []);

  useEffect(() => {
    if (!isTauri) return;
    let live = true;
    void (async () => {
      try {
        const list = await api.listBackups();
        if (live) setBackups(Array.isArray(list) ? list : []);
      } catch {
        if (live) setBackups([]);
      }
    })();
    return () => { live = false; };
  }, []);

  async function run(key: string, action: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(key);
    setMessage('');
    setError('');
    try { await action(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { inFlight.current = false; setBusy(null); }
  }

  const button = desktop
    ? 'inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border border-border/40 bg-secondary/40 text-sm hover:border-primary/50 disabled:opacity-50 cursor-pointer transition-all'
    : 'mn-row justify-center gap-2 min-h-11 disabled:opacity-50';
  const small = 'inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-secondary/60 disabled:opacity-50 cursor-pointer transition-colors';
  const label = 'text-3xs font-semibold tracking-[0.12em] text-muted-foreground/70 uppercase';
  const shown = (backups ?? []).filter((b) => !projectId || b.projectId === projectId);
  const others = (backups ?? []).length - shown.length;

  return (
    <section className={desktop
      ? 'bg-card/60 border border-border/40 rounded-2xl p-5 flex flex-col gap-4 shadow-xs md:col-span-2'
      : 'flex flex-col gap-3'} aria-label="Project backups">
      <h3 className={`${label} flex items-center gap-1.5`}>
        <Archive className="w-3.5 h-3.5 text-primary" />Project backups
      </h3>
      <p className="text-sm text-muted-foreground leading-relaxed">
        {isTauri ? 'Create a checked ZIP of your saved chapters, maps, images, exports and AI conversations. Restore opens a separate local copy and keeps your originals.'
          : 'Project ZIP backup and restore are available in the installed app. Browser storage backup is planned.'}
      </p>
      {isTauri && <>
        <p className="text-xs text-muted-foreground">{projectName ? `Current project: ${projectName}` : 'Open a project to create a backup. You can restore a backup at any time.'}</p>
        <p className="text-xs text-muted-foreground">
          Backups are unencrypted and may contain private writing and AI conversations. Save a copy outside this device for recovery after device loss.
          A restored copy brings its AI conversations back but not the AI connection; choose a provider again in that project.
        </p>
        <div className="flex flex-col sm:flex-row gap-2">
          <button className={button} disabled={!!busy || !projectName} onClick={() => void run('create', async () => {
            setWarnings([]);
            const created = await onBackup();
            setWarnings(created.warnings ?? []);
            setMessage(`Backup saved on this device as ${created.fileName}.`);
            await refresh();
          })}><Archive className="w-4 h-4" />Create backup</button>
          <button className={button} disabled={!!busy} onClick={() => void run('restore', async () => {
            if (await onRestore()) setMessage('Backup restored as a separate project. Find it in your project library.');
          })}>
            <RotateCcw className="w-4 h-4" />Restore backup
          </button>
        </div>

        {warnings.length > 0 && (
          <div role="status" className="flex flex-col gap-1.5 rounded-xl border border-amber-500/30 bg-amber-500/5 px-3 py-2.5">
            <p className="text-xs font-medium text-foreground flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />The backup is complete, with {warnings.length === 1 ? 'one note' : `${warnings.length} notes`}:
            </p>
            <ul className="text-xs text-muted-foreground flex flex-col gap-1 pl-5 list-disc">
              {warnings.map((w) => <li key={w}>{w}</li>)}
            </ul>
          </div>
        )}

        {shown.length > 0 && (
          <div className="flex flex-col gap-2">
            <h4 className={label}>{projectId ? 'Backups of this project' : 'Backups on this device'}</h4>
            <ul className="flex flex-col divide-y divide-border/30 rounded-xl border border-border/30 overflow-hidden" aria-label="Backups on this device">
              {shown.map((b) => (
                <li key={b.path} className="flex flex-col gap-2 px-3 py-2.5 bg-card/30">
                  <div className="flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-foreground truncate">{projectId ? when(b.createdAt) : `${b.projectName || 'Project'} · ${when(b.createdAt)}`}</div>
                      <div className="text-3xs text-muted-foreground truncate">{size(b.size)} · {b.fileName}</div>
                    </div>
                    <button className={small} disabled={!!busy} aria-label={`Save a copy of ${b.fileName}`}
                      onClick={() => void run(`copy:${b.path}`, async () => {
                        const path = await api.saveBackupCopy(b.path, b.fileName);
                        setMessage(path ? `Backup copy saved: ${path}` : 'Save cancelled. The backup is still on this device.');
                      })}>
                      <Download className="w-3.5 h-3.5" />{desktop && 'Save a copy…'}
                    </button>
                    <button className={small} disabled={!!busy} aria-label={`Delete ${b.fileName}`}
                      onClick={() => setConfirmDelete(confirmDelete === b.path ? null : b.path)}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  {confirmDelete === b.path && (
                    <div className="flex flex-wrap items-center gap-2 text-xs" role="group" aria-label={`Confirm deleting ${b.fileName}`}>
                      <span className="text-muted-foreground flex-1 min-w-[12rem]">Delete this backup from this device? This can't be undone.</span>
                      <button className="px-2.5 py-1 rounded-md bg-destructive/90 text-destructive-foreground hover:bg-destructive cursor-pointer disabled:opacity-50" disabled={!!busy}
                        onClick={() => void run(`delete:${b.path}`, async () => {
                          await api.deleteBackup(b.path);
                          setConfirmDelete(null);
                          setMessage('Backup deleted.');
                          await refresh();
                        })}>Delete</button>
                      <button className="px-2.5 py-1 rounded-md text-muted-foreground hover:text-foreground cursor-pointer" onClick={() => setConfirmDelete(null)}>Keep</button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
            <p className="text-3xs text-muted-foreground/80">
              The newest {BACKUPS_KEPT} backups of each project are kept; older ones are removed when you create a new one.
              {projectId && others > 0 ? ` ${others} ${others === 1 ? 'backup belongs' : 'backups belong'} to other projects.` : ''}
            </p>
          </div>
        )}
      </>}
      {busy && <p role="status" className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" />{busy === 'restore' ? 'Restoring…' : busy === 'create' ? 'Preparing project backup…' : 'Working…'}</p>}
      {message && <p role="status" className="text-xs text-muted-foreground break-all">{message}</p>}
      {error && <p role="alert" className="text-sm text-destructive break-words">{error}</p>}
    </section>
  );
}
