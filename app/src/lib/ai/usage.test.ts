import { describe, expect, it } from 'vitest';
import { defaultAiMode, DEFAULT_MODE_KEY, formatTokens, parseCliUsage, recordUsage, summarizeUsage } from './usage';
import { resolveConfig } from './useAiChat';

// Captured from `claude -p /usage --output-format json` (Claude Code, 2026-11-12).
const REPORT =
  'You are currently using your subscription to power your Claude Code usage\n\n' +
  'Current session: 50% used · resets Nov 12, 4pm (Asia/Dhaka)\n' +
  'Current week (all models): 20% used · resets Nov 18, 2pm (Asia/Dhaka)\n' +
  'Current week (Fable): 6% used · resets Nov 18, 2pm (Asia/Dhaka)\n\n' +
  "What's contributing to your limits usage?\n" +
  'Last 24h · 341 requests · 1 session\n  94% of your usage was at >150k context';

describe('Claude Code usage report', () => {
  it('turns the CLI report into limit bars', () => {
    const r = parseCliUsage(REPORT);
    expect(r.headline).toMatch(/subscription/);
    expect(r.windows).toEqual([
      { label: 'Current session', kind: 'session', percent: 50, resets: 'Nov 12, 4pm' },
      { label: 'This week · all models', kind: 'week', percent: 20, resets: 'Nov 18, 2pm' },
      { label: 'This week · Fable', kind: 'week', percent: 6, resets: 'Nov 18, 2pm' },
    ]);
  });

  it('copes with other wording and bad input', () => {
    expect(parseCliUsage('Current week (Opus): 101% used').windows[0]).toEqual({
      label: 'This week · Opus',
      kind: 'week',
      percent: 100,
      resets: undefined,
    });
    expect(parseCliUsage('').windows).toEqual([]);
    expect(parseCliUsage('94% of your usage was at >150k context').windows).toEqual([]);
  });
});

describe('usage through MnemoScript', () => {
  it('totals today and the last 7 days per provider, and drops old entries', () => {
    const now = new Date(2026, 10, 12, 15, 0).getTime();
    recordUsage({ provider: 'anthropic', inputTokens: 1000, outputTokens: 200, costUsd: 0.01 }, now - 3600e3);
    recordUsage({ provider: 'anthropic', inputTokens: 500, outputTokens: 100, costUsd: 0.02 }, now - 2 * 86400e3);
    recordUsage({ provider: 'claude-code', inputTokens: 9000, outputTokens: 900 }, now - 600e3);
    recordUsage({ provider: 'openai', inputTokens: 1, outputTokens: 1 }, now - 10 * 86400e3);
    recordUsage({ provider: 'gemini', inputTokens: 0, outputTokens: 0 }, now); // nothing used: not logged
    const rows = summarizeUsage(new Date(now));
    expect(rows.map((r) => r.provider)).toEqual(['anthropic', 'claude-code']);
    const api = rows[0];
    expect(api.today).toEqual({ replies: 1, inputTokens: 1000, outputTokens: 200, costUsd: 0.01 });
    expect(api.week.replies).toBe(2);
    expect(api.week.costUsd).toBeCloseTo(0.03);
    expect(rows[1].week.costUsd).toBeNull();
    expect(formatTokens(950)).toBe('950');
    expect(formatTokens(1234)).toBe('1.2k');
    expect(formatTokens(56_000)).toBe('56k');
    expect(formatTokens(2_500_000)).toBe('2.5M');
  });

  it('new projects start in the default mode chosen in Settings', () => {
    expect(defaultAiMode()).toBe('ask');
    localStorage.setItem(DEFAULT_MODE_KEY, 'plan');
    expect(resolveConfig(null, false).mode).toBe('plan');
    expect(resolveConfig({ provider: 'anthropic', model: '', mode: 'auto' }, false).mode).toBe('auto');
    localStorage.setItem(DEFAULT_MODE_KEY, 'nonsense');
    expect(defaultAiMode()).toBe('ask');
  });
});
