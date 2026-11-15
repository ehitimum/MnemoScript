import { modelLabel, vendorOfModel, type ModelVendor } from '../../lib/ai/providers';

/**
 * Small round marker showing which company's model wrote something (sessions show one per model
 * used). A plain letter + tint — no vendor logos.
 */
const STYLE: Record<ModelVendor, { letter: string; cls: string }> = {
  anthropic: { letter: 'C', cls: 'bg-[#d97757]/15 text-[#c8643f] ring-[#d97757]/35' },
  openai: { letter: 'O', cls: 'bg-emerald-500/15 text-emerald-500 ring-emerald-500/30' },
  google: { letter: 'G', cls: 'bg-sky-500/15 text-sky-500 ring-sky-500/30' },
  unknown: { letter: '·', cls: 'bg-secondary text-muted-foreground ring-border/40' },
};

export default function ModelBadge({ model, vendor, size = 'sm' }: { model?: string; vendor?: ModelVendor; size?: 'xs' | 'sm' | 'md' }) {
  const v = vendor ?? vendorOfModel(model ?? '');
  const s = STYLE[v];
  const dim = size === 'xs' ? 'w-4 h-4 text-[9px]' : size === 'md' ? 'w-7 h-7 text-xs' : 'w-5 h-5 text-[10px]';
  return (
    <span
      className={`inline-flex items-center justify-center rounded-full font-semibold ring-1 shrink-0 ${dim} ${s.cls}`}
      title={model ? modelLabel(model) : undefined}
      aria-hidden={!model}
    >
      {s.letter}
    </span>
  );
}

/** Overlapping badges for every model used in a session (newest first, max 3). */
export function ModelStack({ models, size = 'sm' }: { models: string[]; size?: 'xs' | 'sm' }) {
  const unique = models.slice(0, 3);
  if (!unique.length) return <ModelBadge vendor="unknown" size={size} />;
  return (
    <span className="inline-flex -space-x-1.5" title={models.map(modelLabel).join(', ')}>
      {unique.map((m) => (
        <ModelBadge key={m} model={m} size={size} />
      ))}
    </span>
  );
}
