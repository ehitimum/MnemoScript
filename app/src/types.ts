export interface Project {
  id: string;
  name: string;
  created_at: string;
  documents: Document[];
}

export interface Document {
  id: string;
  title: string;
  content: string;
  updated_at: string;
}