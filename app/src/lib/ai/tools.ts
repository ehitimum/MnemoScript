import type { Document } from '../../types';
import { DOC_KIND_LABEL, documentToText } from './documents';
import type { AiMode, AiToolSpec } from './types';

/**
 * MnemoScript's AI tools. Every provider (API keys and agent CLIs alike) reaches the project only
 * through these, and they execute here in the frontend, where the documents live.
 *
 * Modes are enforced in code, not left to the model: plan mode never offers a write tool and
 * `executeTool` refuses any tool the mode doesn't offer.
 * Phase 1 ships the read tools; the write tools (edit text / mind map / map) come in Phase 3.
 */

export interface ProjectAccess {
  listDocuments(): Document[];
}

export interface ToolResult {
  content: string;
  isError: boolean;
}

const READ_TOOLS: AiToolSpec[] = [
  {
    name: 'list_documents',
    description:
      'List every document in the open MnemoScript project: chapters and notes (text), mind maps and fantasy maps. ' +
      'Returns id, title, kind and folder for each. Call this before reading, so you use real ids.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'read_document',
    description:
      'Read one document by id. Chapters and notes come back as plain text (headings marked with #); ' +
      'mind maps as their nodes and links; fantasy maps as their regions, labels and named places.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Document id from list_documents' } },
      required: ['id'],
    },
  },
];

/** Write tools are added here in Phase 3; plan mode will never include them. */
const WRITE_TOOLS: AiToolSpec[] = [];

export function toolsForMode(mode: AiMode): AiToolSpec[] {
  return mode === 'plan' ? READ_TOOLS : [...READ_TOOLS, ...WRITE_TOOLS];
}

const ok = (content: string): ToolResult => ({ content, isError: false });
const fail = (content: string): ToolResult => ({ content, isError: true });

export async function executeTool(
  name: string,
  input: Record<string, unknown>,
  access: ProjectAccess,
  mode: AiMode,
): Promise<ToolResult> {
  if (!toolsForMode(mode).some((t) => t.name === name)) {
    return fail(`The tool "${name}" is not available in ${mode} mode.`);
  }
  const docs = access.listDocuments();
  switch (name) {
    case 'list_documents':
      return ok(
        JSON.stringify(
          docs.map((d) => ({ id: d.id, title: d.title, kind: DOC_KIND_LABEL[d.docType], folderId: d.folderId ?? null })),
        ),
      );
    case 'read_document': {
      const id = typeof input.id === 'string' ? input.id : '';
      const doc = docs.find((d) => d.id === id);
      if (!doc) return fail(`No document has the id "${id}". Call list_documents to see the ids.`);
      return ok(`# ${doc.title} (${DOC_KIND_LABEL[doc.docType]})\n\n${documentToText(doc) || '(empty)'}`);
    }
    default:
      return fail(`Unknown tool "${name}".`);
  }
}
