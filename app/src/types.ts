export type DocType = 'text' | 'mindmap';

export interface Project {
  id: string;
  name: string;
  description?: string;
  author?: string;
  created_at: string;
  path?: string;
  documents: Document[];
}

export interface Document {
  id: string;
  title: string;
  /** Rich-text HTML for `text` docs, or a JSON string `{nodes,edges}` for `mindmap` docs. */
  content: string;
  updated_at: string;
  docType: DocType;
  order: number;
}
