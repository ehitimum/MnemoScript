export type DocType = 'text' | 'mindmap' | 'fantasymap';

export interface Project {
  id: string;
  name: string;
  description?: string;
  author?: string;
  created_at: string;
  path?: string;
  documents: Document[];
  /** Directory tree. Documents reference a folder via `folderId`. */
  folders: Folder[];
}

/** A directory in the explorer tree. `parentId == null` → lives at the project root. */
export interface Folder {
  id: string;
  name: string;
  order: number;
  parentId?: string | null;
}

export interface Document {
  id: string;
  title: string;
  /** Rich-text HTML for `text` docs, or a JSON string `{nodes,edges}` for `mindmap` docs. */
  content: string;
  updated_at: string;
  docType: DocType;
  order: number;
  /** Id of the containing folder, or null/undefined when at the project root. */
  folderId?: string | null;
}
