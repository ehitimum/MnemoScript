import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DocType, Document, Project } from '../../types';
import { api } from '../api';
import { runTurn, type RunningTurn } from './client';
import { getProvider, providersFor } from './providers';
import { textHash } from './diff';
import { defaultAiMode } from './usage';
import { documentToText } from './documents';
import { forStorage, newSession, patchChange } from './session';
import type { ProjectAccess } from './tools';
import type {
  AiEvent,
  AiMode,
  AiProviderId,
  AiSession,
  AiSessionSummary,
  ApiKeyProvider,
  CliStatus,
  KeyStatus,
  PairStatus,
  ProjectAiConfig,
} from './types';

export type RateLimitInfo = Extract<AiEvent, { type: 'rateLimit' }>;
export type AiView = 'chat' | 'sessions' | 'connect';

/** The project's connection, or a sensible default for this device. */
export function resolveConfig(ai: ProjectAiConfig | null | undefined, isMobile: boolean): ProjectAiConfig {
  const allowed = providersFor(isMobile);
  if (ai && allowed.some((p) => p.id === ai.provider)) return ai;
  // "Your PC" needs pairing first, so it is never the silent default.
  const provider = allowed.find((p) => p.auth !== 'paired') ?? allowed[0];
  return { provider: provider.id, model: provider.defaultModel, mode: ai?.mode ?? defaultAiMode() };
}

/** How the AI reads and writes the open project's documents (implemented by App). */
export interface AiDocumentBridge {
  /** Latest documents, including unsaved edits in the open one. */
  getDocuments(): Document[];
  listFolderIds(): string[];
  /** Push canvases' debounced edits into the documents now. */
  flush(): void;
  applyContent(docId: string, content: string): Promise<void>;
  createDocument(title: string, docType: DocType, content: string, folderId: string | null): Promise<Document>;
  deleteDocument(docId: string): Promise<void>;
  openDocument(docId: string): void;
}

/** An undo that would also discard edits made after the AI's change: waits for confirmation. */
export interface UndoConflict {
  messageId: string;
  /** The change that conflicts first, then the rest still to undo. */
  callIds: string[];
  docTitle: string;
}

export interface UseAiChatOptions {
  project: Project;
  documents: Document[];
  activeDocument: Document | null;
  isMobile: boolean;
  /** Persist the project's AI connection (App saves project.json). */
  onConfigChange: (config: ProjectAiConfig) => void;
  /** Write access for the edit tools. Without it the AI can only read. */
  bridge?: AiDocumentBridge;
}

/**
 * All AI chat state for one open project, shared by the desktop panel and the phone screen.
 * Mount it under a component keyed by the project id so switching projects starts clean —
 * sessions of project A are never visible in project B.
 */
export function useAiChat({ project, documents, activeDocument, isMobile, onConfigChange, bridge }: UseAiChatOptions) {
  const config = resolveConfig(project.ai, isMobile);
  const provider = getProvider(config.provider);

  const [sessions, setSessions] = useState<AiSessionSummary[] | null>(null);
  const [session, setSession] = useState<AiSession | null>(null);
  const [view, setView] = useState<AiView>('chat');
  const [busy, setBusy] = useState(false);
  const [rateLimit, setRateLimit] = useState<RateLimitInfo | null>(null);
  const [keys, setKeys] = useState<KeyStatus | null>(null);
  const [cli, setCli] = useState<CliStatus | null>(null);
  const [pair, setPair] = useState<PairStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [conflict, setConflict] = useState<UndoConflict | null>(null);
  const [undoing, setUndoing] = useState(false);
  const documentIds = useMemo(() => new Set(documents.map((d) => d.id)), [documents]);

  // Latest values for async callbacks (never read during render).
  const docsRef = useRef(documents);
  const activeRef = useRef(activeDocument);
  const turnRef = useRef<RunningTurn | null>(null);
  const frameRef = useRef<number | null>(null);
  const pendingRef = useRef<AiSession | null>(null);
  const bridgeRef = useRef(bridge);
  /** Ask mode: proposals waiting for Apply / Reject, by tool call id. */
  const approvalsRef = useRef(new Map<string, (approved: boolean) => void>());
  useEffect(() => {
    docsRef.current = documents;
    activeRef.current = activeDocument;
    bridgeRef.current = bridge;
  });

  const rejectAllPending = useCallback(() => {
    const waiting = [...approvalsRef.current.values()];
    approvalsRef.current.clear();
    waiting.forEach((resolve) => resolve(false));
  }, []);

  const refreshSessions = useCallback(() => {
    api.listAiSessions(project.id).then(setSessions).catch(() => setSessions([]));
  }, [project.id]);

  /** Fetch key + CLI status; state is only set from the promise callbacks. */
  const loadStatus = useCallback(
    () =>
      Promise.all([
        api.aiKeyStatus().then(setKeys).catch(() => setKeys({ anthropic: false, openai: false, gemini: false })),
        isMobile ? Promise.resolve() : api.aiCliStatus().then(setCli).catch(() => setCli({ installed: false, loggedIn: false })),
        isMobile ? api.aiPairCheck().then(setPair).catch(() => setPair({ paired: false })) : Promise.resolve(),
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
      rejectAllPending();
      turnRef.current?.cancel();
      if (frameRef.current != null) cancelAnimationFrame(frameRef.current);
    },
    [rejectAllPending],
  );

  const ready =
    provider.auth === 'cli'
      ? !!cli?.installed && !!cli.loggedIn
      : provider.auth === 'paired'
        ? !!pair?.online && !!pair.cli?.loggedIn
        : !!keys?.[provider.id as ApiKeyProvider];
  const statusKnown = provider.auth === 'cli' ? cli != null : provider.auth === 'paired' ? pair != null : keys != null;

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
      const access: ProjectAccess = {
        listDocuments: () => bridgeRef.current?.getDocuments() ?? docsRef.current,
        listFolderIds: bridge ? () => bridgeRef.current?.listFolderIds() ?? [] : undefined,
        flush: () => bridgeRef.current?.flush(),
        applyContent: bridge ? (id, content) => bridgeRef.current!.applyContent(id, content) : undefined,
        createDocument: bridge ? (t, k, c, f) => bridgeRef.current!.createDocument(t, k, c, f) : undefined,
        requestApproval: (callId) => new Promise<boolean>((resolve) => approvalsRef.current.set(callId, resolve)),
      };
      setConflict(null);
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
        access,
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
    [bridge, config, onConfigChange, persist, project.ai, project.name, refreshStatus, session],
  );

  const stop = useCallback(() => {
    rejectAllPending();
    turnRef.current?.cancel();
  }, [rejectAllPending]);

  /** Ask mode: the writer's answer to one proposal (or all of a reply's proposals). */
  const decide = useCallback((callIds: string[], approved: boolean) => {
    for (const id of callIds) {
      const resolve = approvalsRef.current.get(id);
      if (resolve) {
        approvalsRef.current.delete(id);
        resolve(approved);
      }
    }
  }, []);

  /**
   * Undo applied changes in the given order (newest first for "Undo all"). Stops at a change
   * whose document was edited afterwards and asks first, unless `force`.
   */
  const undo = useCallback(
    async (messageId: string, callIds: string[], force = false) => {
      const b = bridgeRef.current;
      if (!b || !session || turnRef.current) return;
      setUndoing(true);
      setConflict(null);
      let s = session;
      try {
        for (let i = 0; i < callIds.length; i++) {
          const callId = callIds[i];
          const ch = s.messages.find((m) => m.id === messageId)?.toolCalls?.find((c) => c.callId === callId)?.change;
          if (!ch || ch.status !== 'applied') continue;
          b.flush();
          const doc = b.getDocuments().find((d) => d.id === ch.docId);
          if (!doc) {
            s = patchChange(s, messageId, callId, { status: 'failed', error: 'The document no longer exists.', before: undefined });
            continue;
          }
          if (!(force && i === 0) && ch.afterHash && textHash(documentToText(doc)) !== ch.afterHash) {
            setConflict({ messageId, callIds: callIds.slice(i), docTitle: doc.title });
            break;
          }
          try {
            if (ch.created) await b.deleteDocument(ch.docId);
            else if (ch.before != null) await b.applyContent(ch.docId, ch.before);
            else continue;
            s = patchChange(s, messageId, callId, { status: 'undone', before: undefined, error: undefined });
          } catch (e) {
            s = patchChange(s, messageId, callId, { error: e instanceof Error ? e.message : String(e) });
            break;
          }
        }
      } finally {
        setUndoing(false);
      }
      if (s !== session) {
        setSession(s);
        persist(s);
      }
    },
    [persist, session],
  );

  const dismissConflict = useCallback(() => setConflict(null), []);
  const openDocument = useCallback((docId: string) => bridgeRef.current?.openDocument(docId), []);

  const startNew = useCallback(() => {
    if (turnRef.current) return;
    setConflict(null);
    setSession(null);
    setView('chat');
  }, []);

  const openSession = useCallback(
    (id: string) => {
      if (turnRef.current) return;
      api
        .loadAiSession(project.id, id)
        .then((s) => {
          setConflict(null);
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
    pair,
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
    canEdit: !!bridge,
    documentIds,
    decide,
    undo,
    undoing,
    conflict,
    dismissConflict,
    openDocument,
    /** A proposal is waiting for Apply / Reject (badges the AI button while the panel is closed). */
    awaitingApproval: !!session?.messages.some((m) => m.pending && m.toolCalls?.some((c) => c.change?.status === 'pending')),
  };
}

export type AiChat = ReturnType<typeof useAiChat>;
