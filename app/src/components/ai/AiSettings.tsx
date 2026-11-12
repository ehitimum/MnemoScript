import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Activity, Bot, Check, ClipboardList, Hand, KeyRound, Laptop, Loader2, RefreshCw, Smartphone, Terminal, Zap } from 'lucide-react';
import { api } from '../../lib/api';
import { getProvider, type ModelVendor } from '../../lib/ai/providers';
import { useAiSettings, type AiSettingsState } from '../../lib/ai/useAiSettings';
import { DEFAULT_MODE_KEY, defaultAiMode, formatTokens, parseCliUsage, type CliUsageReport, type UsageTotals, type UsageWindow } from '../../lib/ai/usage';
import { relativeTime } from '../../lib/ai/format';
import type { AiMode, ApiKeyProvider, PairingState, PairStatus } from '../../lib/ai/types';
import ModelBadge from './ModelBadge';

/**
 * Settings → AI, shared by the desktop settings screen and the phone Settings tab:
 * the Claude subscription (account + plan limits from the writer's own Claude Code; desktop only),
 * API keys, the default mode for new projects, and what MnemoScript used on this device.
 */

type Variant = 'desktop' | 'mobile';

const card = 'bg-card/60 border border-border/40 rounded-2xl p-5 flex flex-col gap-4 shadow-xs';
const label = 'text-3xs font-semibold tracking-[0.12em] text-muted-foreground/70 uppercase';

function Section({ variant, title, icon, wide, action, children }: {
  variant: Variant;
  title: string;
  icon: ReactNode;
  wide?: boolean;
  action?: ReactNode;
  children: ReactNode;
}) {
  const head = (
    <div className="flex items-center gap-2">
      <h3 className={`${label} flex items-center gap-1.5`}>
        {icon}
        {title}
      </h3>
      {action && <div className="ml-auto">{action}</div>}
    </div>
  );
  if (variant === 'desktop') {
    return (
      <section className={`${card} ${wide ? 'md:col-span-2' : ''}`}>
        {head}
        {children}
      </section>
    );
  }
  return (
    <section className="flex flex-col gap-3">
      {head}
      <div className="rounded-2xl border border-border/40 p-4 flex flex-col gap-4" style={{ background: 'color-mix(in srgb, var(--card) 70%, transparent)' }}>
        {children}
      </div>
    </section>
  );
}

export default function AiSettings({ variant }: { variant: Variant }) {
  const mobile = variant === 'mobile';
  const s = useAiSettings(mobile);
  const ic = 'w-3.5 h-3.5 text-primary';
  return (
    <>
      {!mobile && (
        <Section
          variant={variant}
          wide
          title="Claude subscription"
          icon={<Activity className={ic} />}
          action={
            <button
              className="inline-flex items-center gap-1.5 text-3xs font-medium text-muted-foreground hover:text-foreground cursor-pointer disabled:opacity-50"
              onClick={s.refresh}
              disabled={s.refreshing}
              title="Check again"
            >
              <RefreshCw className={`w-3 h-3 ${s.refreshing ? 'animate-spin' : ''}`} />
              {s.usage?.at ? `Updated ${relativeTime(new Date(s.usage.at).toISOString())}` : 'Refresh'}
            </button>
          }
        >
          <ClaudeAccount s={s} />
        </Section>
      )}
      {mobile ? (
        <Section variant={variant} title="Your PC" icon={<Laptop className={ic} />}>
          <PairedPcCard />
        </Section>
      ) : (
        <Section variant={variant} title="Phone pairing" icon={<Smartphone className={ic} />}>
          <PhonePairing />
        </Section>
      )}
      <Section variant={variant} title="API keys" icon={<KeyRound className={ic} />}>
        <div className="flex flex-col divide-y divide-border/30 -my-1">
          {(['anthropic', 'openai', 'gemini'] as ApiKeyProvider[]).map((p) => (
            <KeyRow key={p} id={p} s={s} lg={mobile} />
          ))}
        </div>
        <p className="text-3xs text-muted-foreground/70 leading-relaxed">
          Keys stay in this device’s secure storage, never in a project folder, and are only sent to their own provider.
          {mobile ? ' On phones the assistant uses these keys.' : ''}
        </p>
      </Section>
      <Section variant={variant} title="Assistant" icon={<Bot className={ic} />}>
        <DefaultMode lg={mobile} />
        <LocalUsage s={s} />
      </Section>
    </>
  );
}

// ── Claude subscription ───────────────────────────────────────────────────────

function ClaudeAccount({ s }: { s: AiSettingsState }) {
  const cli = s.cli;
  if (!cli) {
    return (
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Checking Claude Code…
      </p>
    );
  }
  if (!cli.installed || !cli.loggedIn) {
    return (
      <div className="flex flex-col gap-2.5 text-xs text-muted-foreground leading-relaxed">
        <p>
          {cli.installed
            ? 'Claude Code is installed but not signed in. Sign in once in a terminal, then check again:'
            : 'To use your Claude Pro or Max plan, install Claude Code (claude.com/code), then sign in in a terminal:'}
        </p>
        <code className="self-start flex items-center gap-2 rounded-md bg-secondary/70 px-2 py-1 font-mono text-foreground">
          <Terminal className="w-3.5 h-3.5 text-primary" /> claude auth login
        </code>
        <p className="text-3xs text-muted-foreground/70">MnemoScript never sees your Claude password or sign-in; Claude Code keeps it.</p>
      </div>
    );
  }
  const plan = cli.plan ? cli.plan.charAt(0).toUpperCase() + cli.plan.slice(1) : null;
  const report = s.usage?.report;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3 min-w-0">
        <ModelBadge vendor="anthropic" size="md" />
        <div className="flex flex-col min-w-0">
          <span className="text-sm font-medium text-foreground truncate">{cli.email ?? 'Signed in'}</span>
          <span className="text-3xs text-muted-foreground truncate">
            {[cli.orgName, cli.version ? `Claude Code ${cli.version.split(' ')[0]}` : null].filter(Boolean).join(' · ')}
          </span>
        </div>
        {plan && (
          <span className="ml-auto shrink-0 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-0.5 text-3xs font-semibold text-primary">
            {plan} plan
          </span>
        )}
      </div>

      {!s.usage && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Reading your plan limits…
        </p>
      )}
      {s.usage?.error && <p className="text-xs text-muted-foreground">Limits unavailable: {s.usage.error}</p>}
      {report && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {report.windows.map((w) => (
            <LimitBar key={w.label} w={w} />
          ))}
          {!report.windows.length && <p className="text-xs text-muted-foreground">Claude Code didn’t report any limits.</p>}
        </div>
      )}
      <p className="text-3xs text-muted-foreground/70 leading-relaxed">
        Reported by Claude Code. Limits count everything on your plan: claude.ai, Claude Code and MnemoScript.
      </p>
    </div>
  );
}

function LimitBar({ w }: { w: UsageWindow }) {
  const tone = w.percent >= 90 ? 'bg-destructive' : w.percent >= 70 ? 'bg-amber-500' : 'bg-primary';
  const hint = w.kind === 'session' ? '5-hour window' : w.kind === 'week' ? '7-day window' : '';
  return (
    <div className="flex flex-col gap-1.5" role="group" aria-label={w.label}>
      <div className="flex items-baseline gap-2 text-xs">
        <span className="text-foreground/90 font-medium truncate">{w.label}</span>
        <span className={`ml-auto font-mono tabular-nums ${w.percent >= 90 ? 'text-destructive' : w.percent >= 70 ? 'text-amber-500' : 'text-primary'}`}>
          {Math.round(w.percent)}%
        </span>
      </div>
      <div
        className="h-1.5 rounded-full bg-secondary/70 overflow-hidden"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(w.percent)}
        aria-label={`${w.label} used`}
      >
        <div className={`h-full rounded-full ${tone} transition-[width] duration-500`} style={{ width: `${w.percent}%` }} />
      </div>
      <span className="text-3xs text-muted-foreground/80">
        {[hint, w.resets ? `resets ${w.resets}` : null].filter(Boolean).join(' · ')}
      </span>
    </div>
  );
}

// ── API keys ──────────────────────────────────────────────────────────────────

const KEY_VENDOR: Record<ApiKeyProvider, ModelVendor> = { anthropic: 'anthropic', openai: 'openai', gemini: 'google' };

function KeyRow({ id, s, lg }: { id: ApiKeyProvider; s: AiSettingsState; lg: boolean }) {
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const saved = !!s.keys?.[id];
  const p = getProvider(id);
  const small = `${lg ? 'h-9 px-3 text-sm' : 'h-7 px-2.5 text-xs'} rounded-lg font-medium cursor-pointer transition-colors disabled:opacity-40`;

  const save = async () => {
    if (!key.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await s.saveKey(id, key.trim());
      setKey('');
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-2 py-2.5">
      <div className="flex items-center gap-2.5 min-w-0">
        <ModelBadge vendor={KEY_VENDOR[id]} size="sm" />
        <span className={`${lg ? 'text-sm' : 'text-xs'} font-medium text-foreground truncate`}>{p.label.replace(' (API key)', '')}</span>
        {s.keys == null ? (
          <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />
        ) : saved ? (
          <span className="inline-flex items-center gap-1 text-3xs font-medium text-emerald-600 dark:text-emerald-400">
            <Check className="w-3 h-3" /> Saved
          </span>
        ) : (
          <span className="text-3xs text-muted-foreground/70">Not set</span>
        )}
        <div className="ml-auto flex items-center gap-1 shrink-0">
          {saved && !editing &&
            (confirm ? (
              <>
                <button className={`${small} text-muted-foreground hover:bg-secondary/60`} onClick={() => setConfirm(false)}>
                  Keep
                </button>
                <button
                  className={`${small} text-destructive hover:bg-destructive/10`}
                  onClick={() => {
                    setConfirm(false);
                    void s.clearKey(id);
                  }}
                >
                  Remove key
                </button>
              </>
            ) : (
              <button className={`${small} text-muted-foreground hover:text-destructive hover:bg-secondary/60`} onClick={() => setConfirm(true)}>
                Remove
              </button>
            ))}
          {!confirm && (
            <button className={`${small} text-primary hover:bg-primary/10`} onClick={() => setEditing((e) => !e)}>
              {editing ? 'Cancel' : saved ? 'Replace' : 'Add key'}
            </button>
          )}
        </div>
      </div>
      {editing && (
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <input
            type="password"
            autoComplete="off"
            spellCheck={false}
            autoFocus
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder={`Paste your ${p.label.replace(' (API key)', '')} key`}
            aria-label={`${p.label} key`}
            className={`flex-1 min-w-0 bg-background/60 border border-border/50 rounded-lg px-3 outline-none focus:border-primary/50 text-foreground font-mono ${lg ? 'h-11 text-sm' : 'h-8 text-xs'}`}
          />
          <button type="submit" disabled={!key.trim() || busy} className={`${small} bg-primary text-primary-foreground ${lg ? 'h-11' : 'h-8'}`}>
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Save'}
          </button>
        </form>
      )}
      {error && <p className="text-3xs text-destructive">{error}</p>}
    </div>
  );
}

// ── Assistant defaults + local usage ─────────────────────────────────────────

const MODES: { id: AiMode; label: string; hint: string; Icon: typeof Hand }[] = [
  { id: 'plan', label: 'Plan', hint: 'Reads and suggests; never changes anything', Icon: ClipboardList },
  { id: 'ask', label: 'Ask', hint: 'Shows each change for you to apply or reject', Icon: Hand },
  { id: 'auto', label: 'Auto', hint: 'Applies changes; you can undo them', Icon: Zap },
];

function DefaultMode({ lg }: { lg: boolean }) {
  const [mode, setModeState] = useState<AiMode>(defaultAiMode);
  const setMode = (m: AiMode) => {
    setModeState(m);
    try {
      localStorage.setItem(DEFAULT_MODE_KEY, m);
    } catch {
      /* ignore */
    }
  };
  const current = MODES.find((m) => m.id === mode)!;
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs text-foreground/80">Default mode for new projects</span>
      <div className="grid grid-cols-3 gap-1 rounded-lg bg-secondary/50 p-0.5" role="radiogroup" aria-label="Default mode">
        {MODES.map(({ id, label: l, Icon }) => (
          <button
            key={id}
            role="radio"
            aria-checked={mode === id}
            onClick={() => setMode(id)}
            className={`flex items-center justify-center gap-1.5 rounded-md font-medium cursor-pointer transition-all ${lg ? 'h-9 text-sm' : 'h-7 text-xs'} ${
              mode === id ? 'bg-background text-primary shadow-sm' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Icon className="w-3.5 h-3.5" /> {l}
          </button>
        ))}
      </div>
      <span className="text-3xs text-muted-foreground/70">{current.hint}. Each project can still switch in the chat.</span>
    </div>
  );
}

const PROVIDER_VENDOR: Record<string, ModelVendor> = { 'claude-code': 'anthropic', anthropic: 'anthropic', openai: 'openai', gemini: 'google' };
const SHORT_NAME: Record<string, string> = { 'claude-code': 'Claude plan', anthropic: 'Claude API', openai: 'OpenAI', gemini: 'Gemini' };

function totals(t: UsageTotals) {
  if (!t.replies) return <span className="text-muted-foreground/60">—</span>;
  return (
    <span className="tabular-nums">
      {formatTokens(t.inputTokens + t.outputTokens)} tokens
      {t.costUsd != null && t.costUsd > 0 && <span className="text-muted-foreground"> · ${t.costUsd.toFixed(2)}</span>}
    </span>
  );
}

function LocalUsage({ s }: { s: AiSettingsState }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs text-foreground/80">Used through MnemoScript on this device</span>
      {!s.local.length ? (
        <p className="text-3xs text-muted-foreground/70">Nothing yet. Chats and inline commands are counted here.</p>
      ) : (
        <div className="grid grid-cols-[1fr_auto_auto] gap-x-4 gap-y-1.5 text-3xs items-center">
          <span />
          <span className="text-muted-foreground/70 uppercase tracking-wider">Today</span>
          <span className="text-muted-foreground/70 uppercase tracking-wider">7 days</span>
          {s.local.map((row) => (
            <div key={row.provider} className="contents">
              <span className="flex items-center gap-1.5 min-w-0 text-xs text-foreground/90">
                <ModelBadge vendor={PROVIDER_VENDOR[row.provider] ?? 'unknown'} size="xs" />
                <span className="truncate">{SHORT_NAME[row.provider] ?? getProvider(row.provider).label}</span>
              </span>
              <span className="text-foreground/85">{totals(row.today)}</span>
              <span className="text-foreground/85">{totals(row.week)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Phone pairing ─────────────────────────────────────────────────────────────

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** PC: let a phone use this PC's Claude Code over the home network. */
function PhonePairing() {
  const [st, setSt] = useState<PairingState | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [now, setNow] = useState(0);
  const windowOpen = !!st?.window;

  useEffect(() => {
    let alive = true;
    api
      .aiPairingState()
      .then((s) => alive && setSt(s))
      .catch((e: unknown) => alive && setErr(errText(e)));
    return () => {
      alive = false;
    };
  }, []);

  // While the code is shown: tick the countdown and notice when the phone has paired.
  useEffect(() => {
    if (!windowOpen) return;
    const id = window.setInterval(() => {
      setNow(Date.now());
      api.aiPairingState().then(setSt).catch(() => undefined);
    }, 1000);
    return () => window.clearInterval(id);
  }, [windowOpen]);

  const act = (p: Promise<PairingState>) =>
    p
      .then((s) => {
        setSt(s);
        setErr(null);
      })
      .catch((e: unknown) => setErr(errText(e)));

  if (!st) return <p className="text-xs text-muted-foreground">{err ?? 'Loading…'}</p>;
  const left = st.window && now ? Math.max(0, Math.round((st.window.expiresAt - now) / 1000)) : null;
  const btn = 'h-8 px-3 rounded-lg text-xs font-medium cursor-pointer transition-colors disabled:opacity-40';

  return (
    <div className="flex flex-col gap-3.5">
      <label className="flex items-start gap-3 cursor-pointer">
        <input
          type="checkbox"
          className="mt-0.5 w-4 h-4 accent-primary cursor-pointer"
          checked={st.enabled}
          onChange={(e) => void act(api.aiPairingEnable(e.target.checked))}
        />
        <span className="flex flex-col gap-0.5">
          <span className="text-xs text-foreground/90">Let my phone use this PC’s Claude Code</span>
          <span className="text-3xs text-muted-foreground/70 leading-snug">
            The phone sends its AI requests here over your Wi-Fi, encrypted. Only phones you pair can connect.
          </span>
        </span>
      </label>

      {st.enabled && (
        <>
          <p className="text-3xs text-muted-foreground">
            {st.listening ? (
              <>
                This PC: <span className="text-foreground">{st.pcName}</span>
                {st.address && (
                  <>
                    {' '}
                    · <span className="font-mono text-foreground">{st.address}</span>
                  </>
                )}
                {st.port && <span className="font-mono">:{st.port}</span>}
              </>
            ) : (
              'Not listening.'
            )}
          </p>
          {st.window ? (
            <div className="rounded-xl border border-primary/30 bg-primary/[0.06] p-4 flex flex-col items-center gap-2 text-center">
              <span className="text-3xs uppercase tracking-[0.12em] text-muted-foreground">Pairing code</span>
              <span className="font-mono text-3xl tracking-[0.2em] text-foreground" aria-label="Pairing code">
                {st.window.code}
              </span>
              <span className="text-3xs text-muted-foreground leading-relaxed">
                On the phone: AI → Connect → Your PC, then enter this code.
                {left != null && ` Expires in ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}.`}
              </span>
              <button className={`${btn} text-muted-foreground hover:bg-secondary/60`} onClick={() => void act(api.aiPairingClose())}>
                Cancel
              </button>
            </div>
          ) : (
            <button className={`${btn} self-start bg-primary text-primary-foreground hover:bg-primary/90`} onClick={() => void act(api.aiPairingOpen())} disabled={!st.listening}>
              Pair a phone
            </button>
          )}
          {st.devices.length > 0 && (
            <div className="flex flex-col divide-y divide-border/30">
              {st.devices.map((d) => (
                <div key={d.id} className="flex items-center gap-2 py-2 text-xs">
                  <Smartphone className="w-3.5 h-3.5 text-primary" />
                  <span className="text-foreground/90 truncate">{d.name}</span>
                  <span className="text-3xs text-muted-foreground/70 truncate">{d.lastSeen ? `used ${relativeTime(d.lastSeen)}` : 'paired'}</span>
                  <button className={`${btn} ml-auto text-muted-foreground hover:text-destructive hover:bg-secondary/60`} onClick={() => void act(api.aiPairingRemove(d.id))}>
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
          <p className="text-3xs text-muted-foreground/70 leading-relaxed">
            Keep MnemoScript open on this PC while you use the phone. If Windows asks whether MnemoScript may use private networks, choose Allow.
          </p>
        </>
      )}
      {(err || st.error) && <p className="text-3xs text-destructive">{err ?? st.error}</p>}
    </div>
  );
}

/** Phone: the paired PC and its plan limits. */
function PairedPcCard() {
  const [pair, setPair] = useState<PairStatus | null>(null);
  const [usage, setUsage] = useState<CliUsageReport | null>(null);

  const load = useCallback(
    () =>
      api
        .aiPairCheck()
        .catch((): PairStatus => ({ paired: false }))
        .then((p) => {
          setPair(p);
          if (!p.online) return;
          return api
            .aiPairUsage()
            .then((r) => setUsage(parseCliUsage(r.text)))
            .catch(() => setUsage(null));
        }),
    [],
  );
  useEffect(() => {
    void load();
  }, [load]);

  if (!pair) return <p className="text-xs text-muted-foreground">Checking…</p>;
  if (!pair.paired) {
    return (
      <p className="text-xs text-muted-foreground leading-relaxed">
        Not paired. To use your PC’s Claude subscription here, open the AI tab → Connect → Your PC.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 text-sm">
        <Laptop className="w-4 h-4 text-primary" />
        <span className="font-medium text-foreground">{pair.pcName}</span>
        <span className={`text-xs ${pair.online ? 'text-emerald-500' : 'text-amber-500'}`}>{pair.online ? 'connected' : 'not reachable'}</span>
      </div>
      {pair.error && <p className="text-xs text-muted-foreground leading-relaxed">{pair.error}</p>}
      {usage?.windows.map((w) => <LimitBar key={w.label} w={w} />)}
      <div className="flex gap-2">
        <button className="h-9 px-3 rounded-lg text-sm font-medium bg-secondary text-foreground cursor-pointer" onClick={() => void load()}>
          Check again
        </button>
        <button
          className="h-9 px-3 rounded-lg text-sm font-medium text-muted-foreground cursor-pointer"
          onClick={() => void api.aiPairForget().then(load)}
        >
          Unpair
        </button>
      </div>
    </div>
  );
}
