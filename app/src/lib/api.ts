import { invoke } from '@tauri-apps/api/core';
import type { Project, Document, DocType } from '../types';

/**
 * Typed wrapper around the Tauri backend commands defined in
 * `src-tauri/src/lib.rs`. Every command returns an `ApiResponse<T>` envelope;
 * `call` unwraps it and throws on failure so callers can use plain async/await.
 */
interface ApiResponse<T> {
  success: boolean;
  data: T | null;
  error?: string | null;
}

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
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
