import type { AiMode, AiProviderId } from './types';

/**
 * Usage for Settings → AI.
 *  - Plan limits come from the writer's own Claude Code (`claude -p /usage`, answered by the CLI
 *    itself — free and within Anthropic's terms). `parseCliUsage` turns its report into bars.
 *  - What MnemoScript itself used (tokens, cost) is logged on this device per reply, so API-key
 *    users can see what they are spending.
 */

export interface UsageWindow {
  /** "Current session", "This week · all models", "This week · Fable" */
  label: string;
  /** What the window is, for the hint under the bar. */
  kind: 'session' | 'week' | 'other';
  percent: number;
  /** "Nov 12, 4pm" (as the CLI wrote it, without the time-zone name). */
  resets?: string;
}

export interface CliUsageReport {
  windows: UsageWindow[];
  /** e.g. "You are currently using your subscription to power your Claude Code usage" */
  headline?: string;
}

const LINE = /^(.+?):\s*(\d+(?:\.\d+)?)\s*%\s*used(?:\s*[·•-]\s*resets\s+(.+))?$/i;

export function parseCliUsage(text: string): CliUsageReport {
  const windows: UsageWindow[] = [];
  let headline: string | undefined;
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const m = LINE.exec(line);
    if (!m) {
      if (!headline && !windows.length && /subscription|plan|usage/i.test(line)) headline = line;
      continue;
    }
    const name = m[1].trim();
    const week = /^current week/i.exec(name);
    const scope = /\(([^)]+)\)/.exec(name)?.[1];
    const kind: UsageWindow['kind'] = /session/i.test(name) ? 'session' : week ? 'week' : 'other';
    const label =
      kind === 'session' ? 'Current session' : kind === 'week' ? `This week · ${scope ?? 'all models'}` : name;
    windows.push({
      label,
      kind,
      percent: Math.max(0, Math.min(100, Number(m[2]))),
      resets: m[3]?.replace(/\s*\([^)]*\)\s*$/, '').trim() || undefined,
    });
  }
  return { windows, headline };
}

// ── What MnemoScript used (this device) ───────────────────────────────────────

const LOG_KEY = 'mnemoscript:ai-usage-log';
const KEEP_MS = 31 * 86400000;
const MAX_ENTRIES = 3000;

export interface UsageEntry {
  /** Epoch ms. */
  t: number;
  provider: AiProviderId;
  model?: string;
  inputTokens: number;
  outputTokens: number;
  costUsd?: number | null;
}

function readLog(): UsageEntry[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(LOG_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Record one reply's usage (chat turns and inline commands). Never throws. */
export function recordUsage(entry: Omit<UsageEntry, 't'>, now = Date.now()): void {
  try {
    if (!entry.inputTokens && !entry.outputTokens) return;
    const log = readLog().filter((e) => now - e.t < KEEP_MS);
    log.push({ ...entry, t: now });
    localStorage.setItem(LOG_KEY, JSON.stringify(log.slice(-MAX_ENTRIES)));
  } catch {
    /* storage full or unavailable: usage display is best-effort */
  }
}

export interface UsageTotals {
  replies: number;
  inputTokens: number;
  outputTokens: number;
  /** null when the provider reported no cost for any of these replies. */
  costUsd: number | null;
}

export interface ProviderUsage {
  provider: AiProviderId;
  today: UsageTotals;
  week: UsageTotals;
}

const empty = (): UsageTotals => ({ replies: 0, inputTokens: 0, outputTokens: 0, costUsd: null });

function add(t: UsageTotals, e: UsageEntry) {
  t.replies++;
  t.inputTokens += e.inputTokens;
  t.outputTokens += e.outputTokens;
  if (e.costUsd != null) t.costUsd = (t.costUsd ?? 0) + e.costUsd;
}

/** Today (since local midnight) and the last 7 days, per provider, busiest first. */
export function summarizeUsage(now = new Date()): ProviderUsage[] {
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const weekAgo = now.getTime() - 7 * 86400000;
  const by = new Map<AiProviderId, ProviderUsage>();
  for (const e of readLog()) {
    if (e.t < weekAgo) continue;
    const row = by.get(e.provider) ?? { provider: e.provider, today: empty(), week: empty() };
    add(row.week, e);
    if (e.t >= midnight) add(row.today, e);
    by.set(e.provider, row);
  }
  return [...by.values()].sort((a, b) => b.week.replies - a.week.replies);
}

/** 1234 → "1.2k", 2_500_000 → "2.5M". */
export function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

// ── Default mode for projects that haven't picked one ─────────────────────────

export const DEFAULT_MODE_KEY = 'mnemo_ai_mode';

export function defaultAiMode(): AiMode {
  try {
    const v = localStorage.getItem(DEFAULT_MODE_KEY);
    return v === 'plan' || v === 'auto' || v === 'ask' ? v : 'ask';
  } catch {
    return 'ask';
  }
}
