import type { AiProviderId } from './types';

export interface AiModelOption {
  /** Sent to the backend. '' = the provider's / plan's default model. */
  id: string;
  label: string;
  hint?: string;
}

export type ModelVendor = 'anthropic' | 'openai' | 'google' | 'unknown';

export interface AiProviderInfo {
  id: AiProviderId;
  label: string;
  vendor: ModelVendor;
  /** `cli`: the writer's own official CLI sign-in (subscription). `apiKey`: a saved API key. */
  auth: 'cli' | 'apiKey';
  /** CLIs can't run on phones. */
  desktopOnly: boolean;
  models: AiModelOption[];
  defaultModel: string;
  /** The writer may type any model id (vendors ship new ones often). */
  customModels: boolean;
}

/**
 * Provider catalogue. Within one provider the writer can switch models per message
 * (e.g. Opus ↔ Sonnet ↔ Haiku on one Claude subscription); the provider itself is the
 * project's single connection.
 */
export const PROVIDERS: AiProviderInfo[] = [
  {
    id: 'claude-code',
    label: 'Claude (your subscription)',
    vendor: 'anthropic',
    auth: 'cli',
    desktopOnly: true,
    models: [
      { id: '', label: 'Plan default' },
      { id: 'opus', label: 'Opus', hint: 'Deepest, uses limits fastest' },
      { id: 'sonnet', label: 'Sonnet', hint: 'Balanced' },
      { id: 'haiku', label: 'Haiku', hint: 'Fastest, lightest on limits' },
      { id: 'fable', label: 'Fable', hint: 'Most capable, if your plan has it' },
    ],
    defaultModel: '',
    customModels: false,
  },
  {
    id: 'anthropic',
    label: 'Claude (API key)',
    vendor: 'anthropic',
    auth: 'apiKey',
    desktopOnly: false,
    models: [
      { id: 'claude-opus-5-5', label: 'Claude Opus 5.5' },
      { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' },
      { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5' },
      { id: 'claude-fable-5-2', label: 'Claude Fable 5.2' },
    ],
    defaultModel: 'claude-opus-5-5',
    customModels: true,
  },
  {
    id: 'openai',
    label: 'ChatGPT models (API key)',
    vendor: 'openai',
    auth: 'apiKey',
    desktopOnly: false,
    models: [
      { id: 'gpt-5', label: 'GPT-5' },
      { id: 'gpt-5-mini', label: 'GPT-5 mini' },
    ],
    defaultModel: 'gpt-5',
    customModels: true,
  },
  {
    id: 'gemini',
    label: 'Gemini (API key)',
    vendor: 'google',
    auth: 'apiKey',
    desktopOnly: false,
    models: [
      { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
      { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
    ],
    defaultModel: 'gemini-2.5-pro',
    customModels: true,
  },
];

export function getProvider(id: AiProviderId): AiProviderInfo {
  const p = PROVIDERS.find((x) => x.id === id);
  if (!p) throw new Error(`Unknown AI provider "${id}"`);
  return p;
}

/** Providers usable on this device. */
export function providersFor(isMobile: boolean): AiProviderInfo[] {
  return PROVIDERS.filter((p) => !isMobile || !p.desktopOnly);
}

/** Which company's model this is (for the session/message model icon). */
export function vendorOfModel(model: string): ModelVendor {
  const m = model.toLowerCase();
  if (m.startsWith('claude') || ['opus', 'sonnet', 'haiku', 'fable'].includes(m)) return 'anthropic';
  if (/^(gpt|o\d|chatgpt|codex)/.test(m)) return 'openai';
  if (m.startsWith('gemini')) return 'google';
  return 'unknown';
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Human label for a resolved model id:
 * `claude-haiku-4-5-20251001` → "Claude Haiku 4.5", `claude-sonnet-5[1m]` → "Claude Sonnet 5",
 * `gpt-5-mini` → "GPT-5 mini", `gemini-2.5-pro` → "Gemini 2.5 Pro".
 */
export function modelLabel(model: string): string {
  if (!model) return 'Default model';
  const id = model.replace(/\[.*\]$/, '');
  const claude = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$/.exec(id);
  if (claude) return `Claude ${cap(claude[1])} ${claude[2]}${claude[3] ? `.${claude[3]}` : ''}`;
  if (['opus', 'sonnet', 'haiku', 'fable'].includes(id)) return `Claude ${cap(id)}`;
  const gpt = /^gpt-([\d.]+)(?:-(.+))?$/.exec(id);
  if (gpt) return `GPT-${gpt[1]}${gpt[2] ? ` ${gpt[2]}` : ''}`;
  const gem = /^gemini-([\d.]+)-(.+)$/.exec(id);
  if (gem) return `Gemini ${gem[1]} ${gem[2].split('-').map(cap).join(' ')}`;
  return model;
}
