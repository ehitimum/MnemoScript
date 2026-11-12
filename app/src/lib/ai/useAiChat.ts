import { useCallback, useEffect, useRef, useState } from 'react';
import type { Document, Project } from '../../types';
import { api } from '../api';
import { runTurn, type RunningTurn } from './client';
import { getProvider, providersFor } from './providers';
import { forStorage, newSession } from './session';
import type {
  AiEvent,
  AiMode,
  AiProviderId,
  AiSession,
  AiSessionSummary,
  ApiKeyProvider,
  CliStatus,
  KeyStatus,
  ProjectAiConfig,
} from './types';

export type RateLimitInfo = Extract<AiEvent, { type: 'rateLimit' }>;
export type AiView = 'chat' | 'sessions' | 'connect';

/** The project's connection, or a sensible default for this device. */
export function resolveConfig(ai: ProjectAiConfig | null | undefined, isMobile: boolean): ProjectAiConfig {
  const allowed = providersFor(isMobile);
  if (ai && allowed.some((p) => p.id === ai.provider)) return ai;
  const provider = allowed[0];
  return { provider: provider.id, model: provider.defaultModel, mode: ai?.mode ?? 'ask' };
}

export interface UseAiChatOptions {
  project: Project;
  documents: Document[];
  activeDocument: Document | null;
  isMobile: boolean;
  /** Persist the project's AI connection (App saves project.json). */
  onConfigChange: (config: ProjectAiConfig) => void;
}

/**
 * All AI chat state for one open project, shared by the desktop panel and the phone screen.
 * Mount it under a component keyed by the project id so switching projects starts clean —
 * sessions of project A are never visible in project B.
 */
export function useAiChat({ project, documents, activeDocument, isMobile, onConfigChange }: UseAiChatOptions) {
  const config = resolveConfig(project.ai, isMobile);
  const provider = getProvider(config.provider);

  const [sessions, setSessions] = useState<AiSessionSummary[] | null>(null);
  const [session, setSession] = useState<AiSession | null>(null);
  const [view, setView] = useState<AiView>('chat');
  const [busy, setBusy] = useState(false);
  const [rateLimit, setRateLimit] = useState<RateLimitInfo | null>(null);
  const [keys, setKeys] = useState<KeyStatus | null>(null);
  const [cli, setCli] = useState<CliStatus | null>(null);
  const [checking, setChecking] = useState(false);

  // Latest values for async callbacks (never read during render).
  const docsRef = useRef(documents);
  const activeRef = useRef(activeDocument);
  const turnRef = useRef<RunningTurn | null>(null);
  const frameRef = useRef<number | null>(null);
  const pendingRef = useRef<AiSession | null>(null);
  useEffect(() => {
    docsRef.current = documents;
    activeRef.current = activeDocument;
  });

  const refreshSessions = useCallback(() => {
    api.listAiSessions(project.id).then(setSessions).catch(() => setSessions([]));
  }, [project.id]);

  /** Fetch key + CLI status; state is only set from the promise callbacks. */
  const loadStatus = useCallback(
    () =>
      Promise.all([
        api.aiKeyStatus().then(setKeys).catch(() => setKeys({ anthropic: false, openai: false, gemini: false })),
        isMobile ? Promise.resolve() : api.aiCliStatus().then(setCli).catch(() => setCli({ installed: false, loggedIn: false })),
      ]),
    [isMobile],
  );

  /** User-triggered re-check ("I've signed in — check again"). */
  const refreshStatus = useCallback(() => {
    setChecking(true);
    void loadStatus().finally(() => setChecking(false));
  }, [loadStatus]);

  useEffect(() => {
    let alive = true;
    api
      .listAiSessions(project.id)
      .then((s) => alive && setSessions(s))
      .catch(() => alive && setSessions([]));
    return () => {
      alive = false;
    };
  }, [project.id]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  // Stop a running turn if the panel/screen goes away.
  useEffect(
    () => () => {
      turnRef.current?.cancel();
      if (frameRef.current != null) cancelAnimationFrame(frameRef.current);
    },
    [],
  );

  const ready =
    provider.auth === 'cli' ? !!cli?.installed && !!cli.loggedIn : !!keys?.[provider.id as ApiKeyProvider];
  const statusKnown = provider.auth === 'cli' ? cli != null : keys != null;

  const persist = useCallback(
    (s: AiSession) => {
      api
        .saveAiSession(project.id, forStorage(s))
        .then(refreshSessions)
        .catch((e) => console.error('Failed to save AI session:', e));
    },
    [project.id, refreshSessions],
  );

  const send = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || turnRef.current) return;
      if (!project.ai) onConfigChange(config); // record the connection the first time it's used
      const base = session ?? newSession(config.provider);
      setBusy(true);
      setView('chat');
      let savedStart = false;
      const turn = runTurn({
        session: base,
        userText: trimmed,
        provider: config.provider,
        model: config.model,
        mode: config.mode,
        projectName: project.name,
        activeDocument: activeRef.current ? { id: activeRef.current.id, title: activeRef.current.title } : null,
        access: { listDocuments: () => docsRef.current },
        onRateLimit: setRateLimit,
        onUpdate: (s) => {
          if (!savedStart) {
            savedStart = true;
            persist(s); // keep the writer's message even if the app closes mid-reply
          }
          // Streaming can fire many times per frame: render at most once per frame.
          pendingRef.current = s;
          if (frameRef.current == null) {
            frameRef.current = requestAnimationFrame(() => {
              frameRef.current = null;
              if (pendingRef.current) setSession(pendingRef.current);
            });
          }
        },
      });
      turnRef.current = turn;
      void turn.done.then((final) => {
        turnRef.current = null;
        if (frameRef.current != null) {
          cancelAnimationFrame(frameRef.current);
          frameRef.current = null;
        }
        pendingRef.current = null;
        setSession(final);
        setBusy(false);
        persist(final);
        const err = final.messages[final.messages.length - 1]?.error;
        if (err?.kind === 'auth' || err?.kind === 'unavailable') refreshStatus();
      });
    },
    [config, onConfigChange, persist, project.ai, project.name, refreshStatus, session],
  );

  const stop = useCallback(() => turnRef.current?.cancel(), []);

  const startNew = useCallback(() => {
    if (turnRef.current) return;
    setSession(null);
    setView('chat');
  }, []);

  const openSession = useCallback(
    (id: string) => {
      if (turnRef.current) return;
      api
        .loadAiSession(project.id, id)
        .then((s) => {
          setSession(s);
          setView('chat');
        })
        .catch((e) => console.error('Failed to open AI session:', e));
    },
    [project.id],
  );

  const deleteSession = useCallback(
    (id: string) => {
      setSessions((prev) => prev?.filter((s) => s.id !== id) ?? prev);
      setSession((cur) => (cur?.id === id ? null : cur));
      api.deleteAiSession(project.id, id).catch((e) => console.error('Failed to delete AI session:', e));
    },
    [project.id],
  );

  const setModel = useCallback((model: string) => onConfigChange({ ...config, model }), [config, onConfigChange]);
  const setMode = useCallback((mode: AiMode) => onConfigChange({ ...config, mode }), [config, onConfigChange]);
  const setProvider = useCallback(
    (id: AiProviderId) => onConfigChange({ provider: id, model: getProvider(id).defaultModel, mode: config.mode }),
    [config.mode, onConfigChange],
  );

  const saveKey = useCallback(
    async (p: ApiKeyProvider, key: string) => {
      await api.aiSetApiKey(p, key);
      refreshStatus();
    },
    [refreshStatus],
  );
  const clearKey = useCallback(
    async (p: ApiKeyProvider) => {
      await api.aiClearApiKey(p);
      refreshStatus();
    },
    [refreshStatus],
  );

  return {
    config,
    provider,
    ready,
    statusKnown,
    checking,
    keys,
    cli,
    sessions,
    session,
    view,
    setView,
    busy,
    rateLimit,
    send,
    stop,
    startNew,
    openSession,
    deleteSession,
    setModel,
    setMode,
    setProvider,
    saveKey,
    clearKey,
    refreshStatus,
    activeDocument,
  };
}

export type AiChat = ReturnType<typeof useAiChat>;
