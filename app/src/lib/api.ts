import { invoke, Channel } from '@tauri-apps/api/core';
import type { Project, Document, DocType } from '../types';
import type {
  AiEvent,
  AiSession,
  AiSessionSummary,
  AiTurnRequest,
  ApiKeyProvider,
  CliStatus,
  FoundPc,
  PairingState,
  PairStatus,
  KeyStatus,
} from './ai/types';

/**
 * Typed wrapper around the Tauri backend commands defined in
 * `src-tauri/src/lib.rs`. Every command returns an `ApiResponse<T>` envelope;
 * `call` unwraps it and throws on failure so callers can use plain async/await.
 *
 * When the app is opened in a plain browser (e.g. `npm run dev` at
 * localhost:1420 instead of the Tauri window), the native IPC bridge is absent
 * and `invoke` would throw "Cannot read properties of undefined (reading
 * 'invoke')". In that case `call` transparently routes to a localStorage-backed
 * mock (`browserBackend`) so UI work can be done in a normal browser. The
 * desktop build always uses the real backend.
 */
interface ApiResponse<T> {
  success: boolean;
  data: T | null;
  error?: string | null;
}

import { isTauri } from './platform';
import { aiMockEnabled, mockToolResult, mockTurn } from './ai/devMock';

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri) {
    return browserBackend<T>(cmd, args ?? {});
  }
  const res = await invoke<ApiResponse<T>>(cmd, args);
  if (!res.success) {
    throw new Error(res.error || `Command "${cmd}" failed`);
  }
  return res.data as T;
}

/**
 * Invoke a command with a *raw binary body* (Tauri's `ipc::Request`). Used for
 * image bytes: sending a Uint8Array this way is a zero-copy transfer, whereas a
 * JSON `number[]` of a 5 MB photo becomes ~20 MB of text to parse.
 */
async function callRaw<T>(cmd: string, bytes: Uint8Array, headers: Record<string, string>): Promise<T> {
  if (!isTauri) throw new Error(`Browser fallback: unsupported command "${cmd}"`);
  const res = await invoke<ApiResponse<T>>(cmd, bytes, { headers });
  if (!res.success) {
    throw new Error(res.error || `Command "${cmd}" failed`);
  }
  return res.data as T;
}

/** Copy image bytes into the project's assets/ folder; returns the absolute path. */
export function saveAsset(projectId: string, ext: string, bytes: Uint8Array): Promise<string> {
  return callRaw<string>('save_asset', bytes, { 'x-project-id': projectId, 'x-ext': ext });
}

function extOf(file: string): string {
  return /\.([a-zA-Z0-9]+)$/.exec(file)?.[1] ?? 'png';
}

export const api = {
  createProject: (name: string, description?: string, path?: string) =>
    call<Project>('create_project', {
      name,
      description: description ?? null,
      path: path ?? null,
    }),

  saveProject: (project: Project) => call<void>('save_project', { project }),

  loadProject: (projectId: string) => call<Project>('load_project', { projectId }),

  listProjects: () => call<Project[]>('list_projects'),

  openProjectByPath: (path: string) => call<Project>('open_project_by_path', { path }),

  createDocument: (
    projectId: string,
    title: string,
    content: string,
    docType: DocType = 'text',
    order = 0,
  ) => call<Document>('create_document', { projectId, title, content, docType, order }),

  saveDocument: (projectId: string, document: Document) =>
    call<void>('save_document', { projectId, document }),

  loadDocument: (projectId: string, documentId: string) =>
    call<Document>('load_document', { projectId, documentId }),

  deleteDocument: (projectId: string, documentId: string) =>
    call<void>('delete_document', { projectId, documentId }),

  /** Forget a project (registry only) or delete its folder too. */
  deleteProject: (projectId: string, deleteFiles = false) =>
    call<void>('delete_project', { projectId, deleteFiles }),

  renameProject: (projectId: string, name: string) => call<Project>('rename_project', { projectId, name }),

  /**
   * Write an exported file (e.g. a rendered map PNG) into the project's
   * `exports/` folder and return its absolute path. Used where a native
   * "Save as…" dialog isn't available (Android).
   */
  exportFile: (projectId: string, name: string, bytes: Uint8Array) =>
    callRaw<string>('export_file', bytes, { 'x-project-id': projectId, 'x-name': name }),

  /**
   * Pick an image and copy it into the project's assets/, returning the absolute
   * path (or null if cancelled / in the browser). Picking + reading is done with
   * the dialog/fs plugins so it works on desktop and Android alike; the bytes are
   * then handed to the `save_asset` backend command to persist.
   */
  importImage: async (projectId: string): Promise<string | null> => {
    if (!isTauri) return null;
    const [{ open }, { readFile }] = await Promise.all([
      import('@tauri-apps/plugin-dialog'),
      import('@tauri-apps/plugin-fs'),
    ]);
    const selected = await open({
      multiple: false,
      directory: false,
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'] }],
    });
    if (!selected || typeof selected !== 'string') return null; // cancelled
    const bytes = await readFile(selected);
    return saveAsset(projectId, extOf(selected), bytes);
  },

  selectDirectory: () => call<string | null>('select_directory'),

  /* ---------------------------- AI assistant ---------------------------- */
  // Sessions are stored per project (`<project>/ai/sessions/`), so one project never sees another's.

  listAiSessions: (projectId: string) => call<AiSessionSummary[]>('list_ai_sessions', { projectId }),
  loadAiSession: (projectId: string, sessionId: string) => call<AiSession>('load_ai_session', { projectId, sessionId }),
  saveAiSession: (projectId: string, session: AiSession) => call<void>('save_ai_session', { projectId, session }),
  deleteAiSession: (projectId: string, sessionId: string) => call<void>('delete_ai_session', { projectId, sessionId }),

  /** Which providers have an API key saved (keys are never returned to the frontend). */
  aiKeyStatus: () => call<KeyStatus>('ai_key_status'),
  aiSetApiKey: (provider: ApiKeyProvider, key: string) => call<void>('ai_set_api_key', { provider, key }),
  aiClearApiKey: (provider: ApiKeyProvider) => call<void>('ai_clear_api_key', { provider }),
  /** Claude Code CLI: installed / signed in / plan. */
  /** Status of an installed agent CLI: Claude Code (default) or `codex`. */
  aiCliStatus: (provider?: 'claude-code' | 'codex') => call<CliStatus>('ai_cli_status', provider ? { provider } : undefined),
  /** Plan limits as the writer's Claude Code reports them (`/usage`; free). Desktop only. */
  aiCliUsage: () => call<{ text: string }>('ai_cli_usage'),
  // Phone pairing — PC side.
  aiPairingState: () => call<PairingState>('ai_pairing_state'),
  aiPairingEnable: (enabled: boolean) => call<PairingState>('ai_pairing_enable', { enabled }),
  aiPairingOpen: () => call<PairingState>('ai_pairing_open'),
  aiPairingClose: () => call<PairingState>('ai_pairing_close'),
  aiPairingRemove: (deviceId: string) => call<PairingState>('ai_pairing_remove', { deviceId }),
  // Phone pairing — phone side.
  aiPairDiscover: () => call<FoundPc[]>('ai_pair_discover'),
  aiPairConnect: (host: string, code: string, deviceName: string) =>
    call<{ pcName: string; host: string }>('ai_pair_connect', { host, code, deviceName }),
  aiPairCheck: () => call<PairStatus>('ai_pair_check'),
  aiPairUsage: () => call<{ text: string }>('ai_pair_usage'),
  aiPairForget: () => call<void>('ai_pair_forget'),

  /**
   * Start a turn. Events stream to `onEvent` until a terminal `done` / `error`. Tool calls must
   * be answered with `aiToolResult` (see `lib/ai/client.ts`, which does this).
   */
  aiStartTurn: async (request: AiTurnRequest, onEvent: (e: AiEvent) => void): Promise<void> => {
    if (!isTauri) {
      if (aiMockEnabled()) return mockTurn(request, onEvent); // browser preview only
      await call<void>('ai_start_turn', { request });
      return;
    }
    const channel = new Channel<AiEvent>();
    channel.onmessage = onEvent;
    await call<void>('ai_start_turn', { request, onEvent: channel });
  },
  aiToolResult: (turnId: string, callId: string, content: string, isError: boolean) =>
    call<void>('ai_tool_result', { turnId, callId, content, isError }),
  aiCancelTurn: (turnId: string) => call<boolean>('ai_cancel_turn', { turnId }),

  /**
   * Pick one or many images and copy them into the project's assets/, returning
   * their persisted paths. Used by the Fantasy Map builder to import custom icon
   * art (single or whole packs) and base-map backgrounds. Works on desktop and
   * Android via the dialog/fs plugins; a no-op (empty list) in the browser.
   */
  importAssets: async (projectId: string): Promise<string[]> => {
    if (!isTauri) return [];
    const [{ open }, { readFile }] = await Promise.all([
      import('@tauri-apps/plugin-dialog'),
      import('@tauri-apps/plugin-fs'),
    ]);
    const selected = await open({
      multiple: true,
      directory: false,
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'] }],
    });
    if (!selected) return []; // cancelled
    const files = Array.isArray(selected) ? selected : [selected];
    const out: string[] = [];
    for (const file of files) {
      if (typeof file !== 'string') continue;
      const bytes = await readFile(file);
      out.push(await saveAsset(projectId, extOf(file), bytes));
    }
    return out;
  },
};

/* ------------------------------------------------------------------------- *
 * Browser dev fallback
 *
 * A minimal, in-browser stand-in for the Rust backend, persisting to
 * localStorage. Mirrors the shape of each command's return value so the rest
 * of the app behaves the same as on desktop. Native-only features (image
 * import, directory picker) are no-ops here.
 * ------------------------------------------------------------------------- */

const STORAGE_KEY = 'mnemoscript:projects';

function uid(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function loadStore(): Project[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Project[]) : [];
  } catch {
    return [];
  }
}

function saveStore(projects: Project[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
}

const aiStoreKey = (projectId: string) => `mnemoscript:ai-sessions:${projectId}`;

function loadAiStore(projectId: string): AiSession[] {
  try {
    const raw = localStorage.getItem(aiStoreKey(projectId));
    return raw ? (JSON.parse(raw) as AiSession[]) : [];
  } catch {
    return [];
  }
}

function saveAiStore(projectId: string, sessions: AiSession[]): void {
  localStorage.setItem(aiStoreKey(projectId), JSON.stringify(sessions));
}

function findProject(projects: Project[], id: string): Project {
  const p = projects.find((x) => x.id === id);
  if (!p) throw new Error(`Project "${id}" not found`);
  return p;
}

async function browserBackend<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
  const projects = loadStore();
  const now = () => new Date().toISOString();

  switch (cmd) {
    case 'create_project': {
      const project: Project = {
        id: uid(),
        name: String(args.name ?? 'Untitled'),
        description: (args.description as string | null) ?? undefined,
        author: undefined,
        created_at: now(),
        path: (args.path as string | null) ?? `browser://${uid()}`,
        documents: [],
        folders: [],
      };
      projects.push(project);
      saveStore(projects);
      return project as T;
    }

    case 'save_project': {
      const incoming = args.project as Project;
      const idx = projects.findIndex((p) => p.id === incoming.id);
      if (idx >= 0) projects[idx] = incoming;
      else projects.push(incoming);
      saveStore(projects);
      return undefined as T;
    }

    case 'load_project':
      return findProject(projects, String(args.projectId)) as T;

    case 'list_projects':
      return projects as T;

    case 'open_project_by_path': {
      const p = projects.find((x) => x.path === args.path);
      if (!p) throw new Error(`No project at path "${args.path}"`);
      return p as T;
    }

    case 'create_document': {
      const project = findProject(projects, String(args.projectId));
      const doc: Document = {
        id: uid(),
        title: String(args.title ?? 'Untitled'),
        content: String(args.content ?? ''),
        updated_at: now(),
        docType: (args.docType as DocType) ?? 'text',
        order: Number(args.order ?? 0),
      };
      project.documents.push(doc);
      saveStore(projects);
      return doc as T;
    }

    case 'save_document': {
      const project = findProject(projects, String(args.projectId));
      const incoming = args.document as Document;
      const idx = project.documents.findIndex((d) => d.id === incoming.id);
      if (idx >= 0) project.documents[idx] = incoming;
      else project.documents.push(incoming);
      saveStore(projects);
      return undefined as T;
    }

    case 'load_document': {
      const project = findProject(projects, String(args.projectId));
      const doc = project.documents.find((d) => d.id === args.documentId);
      if (!doc) throw new Error(`Document "${args.documentId}" not found`);
      return doc as T;
    }

    case 'delete_document': {
      const project = findProject(projects, String(args.projectId));
      project.documents = project.documents.filter((d) => d.id !== args.documentId);
      saveStore(projects);
      return undefined as T;
    }

    case 'delete_project': {
      const next = projects.filter((p) => p.id !== args.projectId);
      saveStore(next);
      return undefined as T;
    }

    case 'rename_project': {
      const project = findProject(projects, String(args.projectId));
      project.name = String(args.name ?? project.name);
      saveStore(projects);
      return project as T;
    }

    // AI sessions: same per-project scoping as on disk, one localStorage key per project.
    case 'list_ai_sessions':
      return loadAiStore(String(args.projectId))
        .map((s) => ({
          id: s.id, title: s.title, provider: s.provider, models: s.models, createdAt: s.createdAt,
          updatedAt: s.updatedAt, messageCount: s.messages.length,
        }))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) as T;

    case 'load_ai_session': {
      const s = loadAiStore(String(args.projectId)).find((x) => x.id === args.sessionId);
      if (!s) throw new Error('This AI session no longer exists');
      return s as T;
    }

    case 'save_ai_session': {
      const pid = String(args.projectId);
      const incoming = args.session as AiSession;
      saveAiStore(pid, [...loadAiStore(pid).filter((s) => s.id !== incoming.id), incoming]);
      return undefined as T;
    }

    case 'delete_ai_session': {
      const pid = String(args.projectId);
      saveAiStore(pid, loadAiStore(pid).filter((s) => s.id !== args.sessionId));
      return undefined as T;
    }

    // AI providers run in the native backend only (API keys + CLIs never touch the web view).
    case 'ai_key_status':
      return { anthropic: aiMockEnabled(), openai: false, gemini: false } as T;
    case 'ai_cli_status':
      return (aiMockEnabled()
        ? { installed: true, loggedIn: true, version: '2.1.215 (mock)', email: 'writer@example.com', plan: 'pro' }
        : { installed: false, loggedIn: false }) as T;
    case 'ai_pairing_state':
    case 'ai_pairing_enable':
    case 'ai_pairing_open':
      if (aiMockEnabled()) {
        return {
          enabled: true,
          listening: true,
          port: 47815,
          address: '192.168.1.20',
          pcName: 'WRITING-PC',
          devices: [{ id: 'd1', name: 'Pixel 8', createdAt: new Date().toISOString(), lastSeen: new Date().toISOString() }],
          window: cmd === 'ai_pairing_open' ? { code: '4821 7730', expiresAt: Date.now() + 300000 } : null,
        } as T;
      }
      throw new Error('Phone pairing needs the MnemoScript desktop app.');
    case 'ai_pair_check':
      return { paired: false } as T;
    case 'ai_pair_discover':
      return (aiMockEnabled() ? [{ name: 'WRITING-PC', host: '192.168.1.20:47815', id: 'mock' }] : []) as T;
    case 'ai_cli_usage':
      if (aiMockEnabled()) {
        return {
          text:
            'You are currently using your subscription to power your Claude Code usage\n\n' +
            'Current session: 42% used · resets Nov 12, 4pm (Asia/Dhaka)\n' +
            'Current week (all models): 78% used · resets Nov 18, 2pm (Asia/Dhaka)\n' +
            'Current week (Fable): 93% used · resets Nov 18, 2pm (Asia/Dhaka)',
        } as T;
      }
      throw new Error('Usage limits need the MnemoScript desktop app.');
    case 'ai_set_api_key':
    case 'ai_clear_api_key':
    case 'ai_start_turn':
      throw new Error('The AI assistant needs the MnemoScript desktop or Android app.');
    case 'ai_tool_result':
      mockToolResult(String(args.callId), String(args.content ?? ""));
      return undefined as T;
    case 'ai_cancel_turn':
      return false as T;

    // Native-only: no equivalent in a plain browser.
    case 'import_image':
    case 'select_directory':
      return null as T;

    default:
      throw new Error(`Browser fallback: unsupported command "${cmd}"`);
  }
}
