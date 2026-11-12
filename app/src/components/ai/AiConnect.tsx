import { useEffect, useState } from 'react';
import { Check, KeyRound, Laptop, Loader2, RefreshCw, Terminal, Unlink } from 'lucide-react';
import { api } from '../../lib/api';
import type { AiChat } from '../../lib/ai/useAiChat';
import { providersFor, type AiProviderInfo } from '../../lib/ai/providers';
import type { ApiKeyProvider, FoundPc } from '../../lib/ai/types';
import ModelBadge from './ModelBadge';

interface Props {
  chat: AiChat;
  size: 'sm' | 'lg';
  isMobile: boolean;
}

/**
 * Pick the AI this project is connected to (one at a time) and get it ready: Claude Code signs
 * in through its own CLI; the API-key providers take a key that stays in the system keychain.
 */
export default function AiConnect({ chat, size, isMobile }: Props) {
  const lg = size === 'lg';
  const providers = providersFor(isMobile);
  return (
    <div className={`flex-1 min-h-0 overflow-y-auto overscroll-contain flex flex-col gap-3 ${lg ? 'px-4 py-5' : 'px-3 py-4'}`}>
      <div className="flex flex-col gap-1 px-1">
        <span className="text-3xs font-semibold tracking-[0.12em] uppercase text-muted-foreground/70">Connect an AI</span>
        <p className="text-xs text-muted-foreground leading-relaxed">
          One AI is connected to this project at a time. Other projects can use a different one.
          {isMobile && ' On a phone, use your PC’s Claude subscription (paired over Wi-Fi) or an API key (billed per use).'}
        </p>
      </div>
      {providers.map((p) => (
        <ProviderCard key={p.id} p={p} chat={chat} lg={lg} />
      ))}
      {chat.ready && (
        <button className={lg ? 'mn-btn mn-btn-primary mt-1' : 'mt-1 h-9 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 active:scale-[0.98] transition-all cursor-pointer'} onClick={() => chat.setView('chat')}>
          Start chatting
        </button>
      )}
    </div>
  );
}

function ProviderCard({ p, chat, lg }: { p: AiProviderInfo; chat: AiChat; lg: boolean }) {
  const selected = chat.config.provider === p.id;
  const ready =
    p.auth === 'cli'
      ? !!chat.cli?.installed && !!chat.cli.loggedIn
      : p.auth === 'paired'
        ? !!chat.pair?.online && !!chat.pair.cli?.loggedIn
        : !!chat.keys?.[p.id as ApiKeyProvider];
  return (
    <div className={`rounded-xl border transition-all ${selected ? 'border-primary/50 bg-primary/[0.06]' : 'border-border/35 bg-secondary/20'}`}>
      <button
        className={`w-full flex items-center gap-3 text-left cursor-pointer ${lg ? 'px-3.5 py-3' : 'px-3 py-2.5'}`}
        onClick={() => chat.setProvider(p.id)}
        aria-pressed={selected}
      >
        <ModelBadge vendor={p.vendor} size={lg ? 'md' : 'sm'} />
        <span className="flex flex-col flex-1 min-w-0">
          <span className={`text-foreground ${lg ? 'text-sm font-medium' : 'text-xs font-medium'}`}>{p.label}</span>
          <span className="text-3xs text-muted-foreground/75">
            {p.auth === 'cli'
              ? 'Uses your plan through Claude Code on this computer'
              : p.auth === 'paired'
                ? 'Uses your plan through Claude Code on your PC, over Wi-Fi'
                : 'Pay-as-you-go with your own API key'}
          </span>
        </span>
        {ready ? (
          <span className="inline-flex items-center gap-1 text-3xs font-medium text-emerald-500"><Check className="w-3 h-3" /> Ready</span>
        ) : (
          selected && <span className="text-3xs text-muted-foreground">Set up</span>
        )}
      </button>
      {selected && <div className={`${lg ? 'px-3.5 pb-3.5' : 'px-3 pb-3'}`}>{p.auth === 'cli' ? <CliSetup chat={chat} lg={lg} /> : p.auth === 'paired' ? <PairSetup chat={chat} lg={lg} /> : <KeySetup p={p} chat={chat} lg={lg} />}</div>}
    </div>
  );
}

function CliSetup({ chat, lg }: { chat: AiChat; lg: boolean }) {
  const cli = chat.cli;
  const recheck = (
    <button
      className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline cursor-pointer disabled:opacity-50"
      onClick={chat.refreshStatus}
      disabled={chat.checking}
    >
      {chat.checking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />} Check again
    </button>
  );
  if (!cli) return <p className="text-xs text-muted-foreground flex items-center gap-1.5"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Looking for Claude Code…</p>;
  if (!cli.installed) {
    return (
      <div className="flex flex-col gap-2 text-xs text-muted-foreground">
        <p>Claude Code isn’t installed on this computer. Install it from <span className="text-foreground">claude.com/code</span>, sign in once in a terminal, then check again.</p>
        {recheck}
      </div>
    );
  }
  if (!cli.loggedIn) {
    return (
      <div className="flex flex-col gap-2 text-xs text-muted-foreground">
        <p>Claude Code {cli.version ? `(${cli.version.split(' ')[0]})` : ''} is installed but not signed in. Run this once in a terminal and sign in with your Claude account:</p>
        <code className={`self-start flex items-center gap-2 rounded-md bg-secondary/70 px-2 py-1 font-mono text-foreground ${lg ? 'text-sm' : 'text-xs'}`}>
          <Terminal className="w-3.5 h-3.5 text-primary" /> claude auth login
        </code>
        {recheck}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1 text-xs text-muted-foreground">
      <p>
        Signed in{cli.email ? <> as <span className="text-foreground">{cli.email}</span></> : ''}
        {cli.plan ? <> · <span className="text-foreground capitalize">{cli.plan}</span> plan</> : ''}.
      </p>
      <p className="text-3xs text-muted-foreground/70">MnemoScript never sees your Claude login — Claude Code handles it. It can only reach this project, through MnemoScript.</p>
    </div>
  );
}

function KeySetup({ p, chat, lg }: { p: AiProviderInfo; chat: AiChat; lg: boolean }) {
  const [key, setKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const id = p.id as ApiKeyProvider;
  const saved = !!chat.keys?.[id];

  const save = async () => {
    if (!key.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await chat.saveKey(id, key);
      setKey('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-2 text-xs text-muted-foreground">
      {saved && (
        <div className="flex items-center gap-2">
          <KeyRound className="w-3.5 h-3.5 text-primary" />
          <span>A key is saved on this device.</span>
          <button className="ml-auto text-3xs text-muted-foreground hover:text-destructive cursor-pointer" onClick={() => void chat.clearKey(id)}>
            Remove
          </button>
        </div>
      )}
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
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder={saved ? 'Replace key' : 'Paste your API key'}
          className={`flex-1 min-w-0 bg-background/60 border border-border/50 rounded-lg px-3 outline-none focus:border-primary/50 text-foreground font-mono ${lg ? 'h-11 text-sm' : 'h-8 text-xs'}`}
        />
        <button
          type="submit"
          disabled={!key.trim() || saving}
          className={`rounded-lg bg-primary text-primary-foreground font-medium px-3 cursor-pointer disabled:opacity-40 ${lg ? 'h-11 text-sm' : 'h-8 text-xs'}`}
        >
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Save'}
        </button>
      </form>
      {error && <p className="text-3xs text-destructive">{error}</p>}
      <p className="text-3xs text-muted-foreground/70">Kept in your system’s secure storage, never in the project folder. Used only from this device.</p>
    </div>
  );
}

/** "Pixel 8" from the WebView's user agent; falls back to "Phone". */
function deviceName(): string {
  const m = /Android [\d.]+; ([^;)]+)/.exec(typeof navigator !== 'undefined' ? navigator.userAgent : '');
  return m?.[1]?.replace(/\s*Build\/.*$/, '').trim() || 'Phone';
}

/** Phone: find the PC on the Wi-Fi, enter the code it shows, and use its Claude Code. */
function PairSetup({ chat, lg }: { chat: AiChat; lg: boolean }) {
  const pair = chat.pair;
  const [found, setFound] = useState<FoundPc[] | null>(null);
  const [host, setHost] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const field = `w-full bg-background/60 border border-border/50 rounded-lg px-3 outline-none focus:border-primary/50 text-foreground ${lg ? 'h-11 text-sm' : 'h-8 text-xs'}`;
  const btn = `rounded-lg font-medium cursor-pointer disabled:opacity-40 ${lg ? 'h-11 text-sm px-4' : 'h-8 text-xs px-3'}`;
  const paired = !!pair?.paired;

  // Look for PCs on the network while the card is open (answers arrive within ~2 s).
  useEffect(() => {
    if (paired) return;
    let alive = true;
    api
      .aiPairDiscover()
      .then((f) => {
        if (!alive) return;
        setFound(f);
        if (f[0]) setHost((h) => h || f[0].host);
      })
      .catch(() => alive && setFound([]));
    return () => {
      alive = false;
    };
  }, [paired]);

  if (paired && pair) {
    return (
      <div className="flex flex-col gap-2.5 text-xs text-muted-foreground">
        <div className="flex items-center gap-2">
          <Laptop className="w-4 h-4 text-primary" />
          <span className="text-foreground font-medium">{pair.pcName}</span>
          <span className={pair.online ? 'text-emerald-500' : 'text-amber-500'}>{pair.online ? '· connected' : '· not reachable'}</span>
        </div>
        {pair.error && <p className="leading-relaxed">{pair.error}</p>}
        {pair.online && !pair.cli?.loggedIn && (
          <p>
            Claude Code on the PC isn’t signed in. Run <code className="font-mono text-foreground">claude auth login</code> there.
          </p>
        )}
        <div className="flex gap-2">
          <button className={`${btn} bg-secondary text-foreground inline-flex items-center gap-1.5`} onClick={chat.refreshStatus} disabled={chat.checking}>
            {chat.checking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />} Check again
          </button>
          <button
            className={`${btn} text-muted-foreground hover:text-destructive inline-flex items-center gap-1.5`}
            onClick={() => void api.aiPairForget().then(chat.refreshStatus)}
          >
            <Unlink className="w-3.5 h-3.5" /> Unpair
          </button>
        </div>
      </div>
    );
  }

  const connect = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.aiPairConnect(host, code, deviceName());
      setCode('');
      chat.refreshStatus();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="flex flex-col gap-2.5 text-xs text-muted-foreground"
      onSubmit={(e) => {
        e.preventDefault();
        void connect();
      }}
    >
      <p className="leading-relaxed">
        On your PC, open MnemoScript → Settings → AI → <span className="text-foreground">Phone pairing</span>, turn it on and choose{' '}
        <span className="text-foreground">Pair a phone</span>. Both need to be on the same Wi-Fi.
      </p>
      {found == null ? (
        <p className="flex items-center gap-2">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Looking for your PC…
        </p>
      ) : (
        found.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setHost(f.host)}
            className={`flex items-center gap-2 rounded-lg border px-3 text-left cursor-pointer ${lg ? 'h-11' : 'h-8'} ${
              host === f.host ? 'border-primary/50 bg-primary/10 text-foreground' : 'border-border/50'
            }`}
          >
            <Laptop className="w-4 h-4 text-primary" /> {f.name} <span className="ml-auto font-mono text-3xs">{f.host}</span>
          </button>
        ))
      )}
      <input className={`${field} font-mono`} value={host} onChange={(e) => setHost(e.target.value)} placeholder="PC address, e.g. 192.168.1.20" aria-label="PC address" inputMode="url" />
      <input
        className={`${field} font-mono tracking-widest`}
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/[^\d ]/g, '').slice(0, 9))}
        placeholder="8-digit code"
        aria-label="Pairing code"
        inputMode="numeric"
        autoComplete="one-time-code"
      />
      <button type="submit" className={`${btn} bg-primary text-primary-foreground`} disabled={busy || !host.trim() || code.replace(/\D/g, '').length !== 8}>
        {busy ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : 'Pair'}
      </button>
      {error && <p className="text-destructive leading-relaxed">{error}</p>}
    </form>
  );
}
