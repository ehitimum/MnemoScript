/** A small status dot shared by the sync pill and settings rows. */
export default function SyncDot({ tone }: { tone: 'ok' | 'busy' | 'warn' | 'muted' }) {
  const color =
    tone === 'ok' ? 'bg-emerald-500/80'
    : tone === 'busy' ? 'bg-primary/80 animate-pulse'
    : tone === 'warn' ? 'bg-amber-500'
    : 'bg-muted-foreground/40';
  return <span aria-hidden className={`inline-block w-1.5 h-1.5 rounded-full ${color}`} />;
}
