import { invoke } from '@tauri-apps/api/core';
import type { Project, Document, DocType } from '../types';

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

/** True when running inside the Tauri WebView (native backend available). */
const isTauri =
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

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

  /** Opens a native image picker, copies into the project's assets/, returns the absolute path (or null if cancelled). */
  importImage: (projectId: string) => call<string | null>('import_image', { projectId }),

  selectDirectory: () => call<string | null>('select_directory'),
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

    // Native-only: no equivalent in a plain browser.
    case 'import_image':
    case 'select_directory':
      return null as T;

    default:
      throw new Error(`Browser fallback: unsupported command "${cmd}"`);
  }
}
