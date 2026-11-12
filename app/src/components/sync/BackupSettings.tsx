import { useRef, useState } from 'react';
import { Archive, Download, Loader2, RotateCcw } from 'lucide-react';
import { api } from '../../lib/api';
import { isTauri } from '../../lib/platform';

export interface BackupActions {
  projectName?: string;
  onBackup: () => Promise<string>;
  onRestore: (bytes: Uint8Array) => Promise<void>;
}

/** Recovery remains available without enabling sync or granting device access. */
export default function BackupSettings({ variant, projectName, onBackup, onRestore }: BackupActions & {
  variant: 'desktop' | 'mobile';
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [backupPath, setBackupPath] = useState('');
  const input = useRef<HTMLInputElement>(null);
  // Ref closes the double-click window before React commits the disabled state.
  const inFlight = useRef(false);
  async function run(action: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setMessage('');
    setError('');
    try { await action(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { inFlight.current = false; setBusy(false); }
  }
  const button = variant === 'mobile'
    ? 'mn-row justify-center gap-2 min-h-11 disabled:opacity-50'
    : 'inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border border-border/40 bg-secondary/40 text-sm hover:border-primary/50 disabled:opacity-50 cursor-pointer transition-all';
  return (
    <section className={variant === 'desktop'
      ? 'bg-card/60 border border-border/40 rounded-2xl p-5 flex flex-col gap-4 shadow-xs md:col-span-2'
      : 'flex flex-col gap-3'} aria-label="Project backups">
      <h3 className="text-3xs font-semibold tracking-[0.12em] text-muted-foreground/70 uppercase flex items-center gap-1.5">
        <Archive className="w-3.5 h-3.5 text-primary" />Project backups
      </h3>
      <p className="text-sm text-muted-foreground leading-relaxed">
        {isTauri ? 'Create a checked ZIP of your saved chapters, maps, images, exports and AI conversations. Restore opens a separate local copy and keeps your originals.'
          : 'Project ZIP backup and restore are available in the installed app. Browser storage backup is planned.'}
      </p>
      {isTauri && <>
        <p className="text-xs text-muted-foreground">{projectName ? `Current project: ${projectName}` : 'Open a project to create a backup. You can restore a backup at any time.'}</p>
        <p className="text-xs text-muted-foreground">Backups are unencrypted and may contain private writing and AI conversations. Save a copy outside this device for recovery after device loss.</p>
        <div className="flex flex-col sm:flex-row gap-2">
          <button className={button} disabled={busy || !projectName} onClick={() => void run(async () => {
            setBackupPath('');
            const path = await onBackup();
            setBackupPath(path);
            setMessage(`Backup created on this device: ${path}`);
          })}><Archive className="w-4 h-4" />Create backup</button>
          <button className={button} disabled={busy} onClick={() => input.current?.click()}>
            <RotateCcw className="w-4 h-4" />Restore backup
          </button>
          {backupPath && <button className={button} disabled={busy} onClick={() => void run(async () => {
            const path = await api.saveBackupCopy(backupPath);
            setMessage(path ? `Backup copy saved: ${path}` : `Save cancelled. Your backup is still on this device: ${backupPath}`);
          })}><Download className="w-4 h-4" />Save a copy…</button>}
        </div>
        <input ref={input} type="file" accept=".zip,application/zip" aria-label="Choose project backup" className="hidden" disabled={busy}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (!file) return;
            void run(async () => {
              if (file.size > 600 * 1024 * 1024) throw new Error('Backup exceeds the 600 MiB archive limit.');
              await onRestore(new Uint8Array(await file.arrayBuffer()));
              setMessage('Backup restored as a separate project. Find it in your project library.');
            });
          }} />
      </>}
      {busy && <p role="status" className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" />Preparing project backup…</p>}
      {message && <p role="status" className="text-xs text-muted-foreground break-all">{message}</p>}
      {error && <p role="alert" className="text-sm text-destructive break-words">{error}</p>}
    </section>
  );
}
