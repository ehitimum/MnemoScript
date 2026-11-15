import { Cloud, CloudOff, RefreshCw, TriangleAlert } from 'lucide-react';
import { describe, projectSync } from '../../lib/sync/useSync';
import type { SyncStatus } from '../../lib/sync/types';

/**
 * Quiet sync indicator for the open project. Hidden entirely when the project isn't synced
 * and no account is connected, so local-only writers never see sync chrome.
 */
export default function SyncPill({ status, projectId, onClick, compact = false }: {
  status: SyncStatus;
  projectId?: string;
  onClick: () => void;
  compact?: boolean;
}) {
  const project = projectSync(status, projectId);
  if (!project && status.state !== 'needs-auth') return null;
  const { label, tone } = describe(status, project);
  const Icon = tone === 'busy' && project?.state === 'syncing' ? RefreshCw
    : tone === 'warn' ? TriangleAlert
    : project?.state === 'offline' || status.state === 'offline' ? CloudOff
    : Cloud;
  const color = tone === 'warn' ? 'text-amber-500' : tone === 'ok' ? 'text-primary' : 'text-muted-foreground';
  return (
    <button
      type="button"
      onClick={onClick}
      title={project?.pending ? `${label} · ${project.pending} change${project.pending === 1 ? '' : 's'} not yet on Google Drive` : label}
      aria-label={`Sync: ${label}`}
      className={`flex items-center gap-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-all cursor-pointer ${compact ? 'w-9 h-9 justify-center' : 'h-8 px-2.5'}`}
    >
      <Icon className={`w-4 h-4 ${color} ${project?.state === 'syncing' ? 'animate-spin' : ''}`} />
      {!compact && <span className="text-xs whitespace-nowrap">{label}</span>}
    </button>
  );
}
