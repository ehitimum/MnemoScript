import type { DocType, Document } from '../../types';
import { contentToText, DOC_KIND_LABEL, documentToText } from './documents';
import { paragraphHunks, textHash } from './diff';
import { applyFantasyMapEdit, applyMindMapEdit, newMindMap, type ListLine } from './structEdits';
import { applyTextEdits, EditError, textToHtml, type TextEdit } from './textEdits';
import type { AiChange, AiChangePreview, AiMode, AiToolSpec } from './types';

/**
 * MnemoScript's AI tools. Every provider (API keys and agent CLIs alike) reaches the project only
 * through these, and they execute here in the frontend, where the documents live.
 *
 * Modes are enforced in code, not left to the model: plan mode never offers a write tool and
 * `executeTool` refuses any tool the mode doesn't offer. In ask mode a write waits for the
 * writer's Apply/Reject; in auto mode it applies straight away and keeps the old content for undo.
 */

export interface ProjectAccess {
  listDocuments(): Document[];
  /** Folder ids, to validate `create_document`'s folder. */
  listFolderIds?(): string[];
  /** Save canvases' pending (debounced) edits so a write starts from the latest content. */
  flush?(): void;
  /** Write a document's new content (and refresh it if it's open). */
  applyContent?(docId: string, content: string): Promise<void>;
  createDocument?(title: string, docType: DocType, content: string, folderId: string | null): Promise<Document>;
  /** Ask mode: resolves when the writer applies (true) or rejects (false) the proposal. */
  requestApproval?(callId: string): Promise<boolean>;
}

export interface ToolContext {
  callId: string;
  /** Ask mode: called with the proposal before waiting for the writer. */
  onProposal?: (change: AiChange) => void;
}

export interface ToolResult {
  content: string;
  isError: boolean;
  change?: AiChange;
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

const idProp = { type: 'string', description: 'Document id from list_documents' };

const WRITE_TOOLS: AiToolSpec[] = [
  {
    name: 'edit_text',
    description:
      'Change a chapter or note by replacing exact text. Read the document first. Each "find" must be copied exactly from ' +
      'read_document (whole or partial paragraphs; the #, - and > markers are optional) and must match only once. ' +
      '"replace" is the new text: separate paragraphs with a blank line, or use "" to delete. To insert, include the ' +
      'neighbouring sentence in both. Formatting around the change is kept. Edits apply in order; prefer several small ' +
      'edits to rewriting long passages.',
    inputSchema: {
      type: 'object',
      properties: {
        id: idProp,
        edits: {
          type: 'array',
          items: {
            type: 'object',
            properties: { find: { type: 'string' }, replace: { type: 'string' } },
            required: ['find', 'replace'],
          },
        },
      },
      required: ['id', 'edits'],
    },
  },
  {
    name: 'write_document',
    description:
      'Replace the whole text of a chapter or note. Only for an empty document or a full rewrite the writer asked for: ' +
      'it drops existing formatting, so use edit_text for anything smaller. Light markdown: # headings, - lists, ' +
      '> quotes, **bold**, *italic*, a blank line between paragraphs.',
    inputSchema: {
      type: 'object',
      properties: { id: idProp, text: { type: 'string' } },
      required: ['id', 'text'],
    },
  },
  {
    name: 'create_document',
    description:
      'Create a new document. kind "text" is a chapter or note (optional "text" in light markdown); kind "mindmap" is ' +
      'a mind map whose central node is the title (optional "ideas" become first-level nodes). Fantasy maps cannot be created.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        kind: { type: 'string', enum: ['text', 'mindmap'] },
        text: { type: 'string' },
        ideas: { type: 'array', items: { type: 'string' } },
        folder_id: { type: 'string', description: 'Optional folder id from list_documents' },
      },
      required: ['title', 'kind'],
    },
  },
  {
    name: 'edit_mind_map',
    description:
      'Change a mind map: add nodes (a "parent" links the new node under it), rename or remove nodes, add or remove links. ' +
      'Use the [ids] from read_document; give a new node a "ref" to use it as a parent or link end in the same call.',
    inputSchema: {
      type: 'object',
      properties: {
        id: idProp,
        add_nodes: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              label: { type: 'string' },
              parent: { type: 'string', description: 'Existing node id or the ref of a node added earlier in this call' },
              ref: { type: 'string', description: 'Your own name for this new node, to refer to it in this call' },
              link_label: { type: 'string' },
            },
            required: ['label'],
          },
        },
        rename_nodes: {
          type: 'array',
          items: { type: 'object', properties: { id: { type: 'string' }, label: { type: 'string' } }, required: ['id', 'label'] },
        },
        remove_nodes: { type: 'array', items: { type: 'string' } },
        add_links: {
          type: 'array',
          items: {
            type: 'object',
            properties: { from: { type: 'string' }, to: { type: 'string' }, label: { type: 'string' } },
            required: ['from', 'to'],
          },
        },
        remove_links: {
          type: 'array',
          items: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } }, required: ['from', 'to'] },
        },
      },
      required: ['id'],
    },
  },
  {
    name: 'edit_fantasy_map',
    description:
      'Change the names on a fantasy map: rename regions and places, edit, add or remove text labels. Use the [ids] from ' +
      'read_document; a new label can be placed "near" a region or place id. Terrain, borders, routes and icons cannot be changed.',
    inputSchema: {
      type: 'object',
      properties: {
        id: idProp,
        rename_regions: {
          type: 'array',
          items: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' } }, required: ['id', 'name'] },
        },
        rename_places: {
          type: 'array',
          items: { type: 'object', properties: { id: { type: 'string' }, label: { type: 'string' } }, required: ['id', 'label'] },
        },
        edit_labels: {
          type: 'array',
          items: { type: 'object', properties: { id: { type: 'string' }, text: { type: 'string' } }, required: ['id', 'text'] },
        },
        add_labels: {
          type: 'array',
          items: {
            type: 'object',
            properties: { text: { type: 'string' }, near: { type: 'string' }, size: { type: 'number' } },
            required: ['text'],
          },
        },
        remove_labels: { type: 'array', items: { type: 'string' } },
      },
      required: ['id'],
    },
  },
];

export const WRITE_TOOL_NAMES = new Set(WRITE_TOOLS.map((t) => t.name));

export function toolsForMode(mode: AiMode): AiToolSpec[] {
  return mode === 'plan' ? READ_TOOLS : [...READ_TOOLS, ...WRITE_TOOLS];
}

const ok = (content: string, change?: AiChange): ToolResult => ({ content, isError: false, change });
const fail = (content: string, change?: AiChange): ToolResult => ({ content, isError: true, change });
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/** Some models send nested arrays as JSON strings; accept both. */
function coerce(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input ?? {})) {
    if (typeof v === 'string' && /^\s*[[{]/.test(v) && k !== 'text' && k !== 'title') {
      try {
        out[k] = JSON.parse(v);
        continue;
      } catch {
        /* keep the string */
      }
    }
    out[k] = v;
  }
  return out;
}

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;
const textPreview = (before: string, after: string): AiChangePreview => ({ kind: 'text', hunks: paragraphHunks(before, after) });
const listPreview = (lines: ListLine[]): AiChangePreview => ({ kind: 'list', lines });

interface Planned {
  change: Omit<AiChange, 'status'>;
  content: string;
  doc?: Document;
  create?: { title: string; docType: DocType; folderId: string | null };
}

function planWrite(name: string, input: Record<string, unknown>, docs: Document[], folderIds?: string[]): Planned {
  if (name === 'create_document') {
    const title = str(input.title);
    if (!title) throw new EditError('create_document needs a "title".');
    const docType: DocType = input.kind === 'mindmap' ? 'mindmap' : 'text';
    const ideas = Array.isArray(input.ideas) ? input.ideas.map(str).filter(Boolean) : [];
    const content = docType === 'mindmap' ? newMindMap(title, ideas) : textToHtml(typeof input.text === 'string' ? input.text : '');
    const folder = str(input.folder_id);
    if (folder && folderIds && !folderIds.includes(folder)) {
      throw new EditError(`create_document: there is no folder with the id "${folder}". Leave folder_id out to create it at the top level.`);
    }
    const preview =
      docType === 'mindmap'
        ? listPreview([{ op: 'add', text: `Mind map “${title}”` }, ...ideas.map((i) => ({ op: 'add' as const, text: `Node “${i}”` }))])
        : textPreview('', contentToText('text', content));
    return {
      change: { docId: '', docTitle: title, docType, summary: docType === 'mindmap' ? 'New mind map' : 'New chapter', preview, created: true },
      content,
      create: { title, docType, folderId: folder || null },
    };
  }

  const id = str(input.id);
  const doc = docs.find((d) => d.id === id);
  if (!doc) throw new EditError(`No document has the id "${id}". Call list_documents to see the ids.`);
  const wrongKind = (want: DocType) => {
    if (doc.docType === want) return;
    const tool = doc.docType === 'mindmap' ? 'edit_mind_map' : doc.docType === 'fantasymap' ? 'edit_fantasy_map' : 'edit_text';
    throw new EditError(`"${doc.title}" is a ${DOC_KIND_LABEL[doc.docType]}; use ${tool} for it.`);
  };
  const base = { docId: doc.id, docTitle: doc.title, docType: doc.docType };
  const beforeText = documentToText(doc);

  switch (name) {
    case 'edit_text': {
      wrongKind('text');
      const edits = Array.isArray(input.edits) ? (input.edits as TextEdit[]) : [];
      const content = applyTextEdits(doc.content, edits);
      const after = contentToText('text', content);
      if (after === beforeText) throw new EditError('These edits would not change the text.');
      return { change: { ...base, summary: plural(edits.length, 'edit'), preview: textPreview(beforeText, after) }, content, doc };
    }
    case 'write_document': {
      wrongKind('text');
      if (typeof input.text !== 'string') throw new EditError('write_document needs "text".');
      const content = textToHtml(input.text);
      const after = contentToText('text', content);
      return {
        change: { ...base, summary: beforeText.trim() ? 'Rewrite' : 'New text', preview: textPreview(beforeText, after) },
        content,
        doc,
      };
    }
    case 'edit_mind_map': {
      wrongKind('mindmap');
      const r = applyMindMapEdit(doc.content, input);
      return { change: { ...base, summary: plural(r.lines.length, 'change'), preview: listPreview(r.lines) }, content: r.content, doc };
    }
    case 'edit_fantasy_map': {
      wrongKind('fantasymap');
      const r = applyFantasyMapEdit(doc.content, input);
      return { change: { ...base, summary: plural(r.lines.length, 'change'), preview: listPreview(r.lines) }, content: r.content, doc };
    }
    default:
      throw new EditError(`Unknown tool "${name}".`);
  }
}

async function executeWrite(name: string, input: Record<string, unknown>, access: ProjectAccess, mode: AiMode, ctx?: ToolContext) {
  if (!access.applyContent) return fail('Editing is not available in this window.');
  const plan = () => {
    access.flush?.();
    return planWrite(name, input, access.listDocuments(), access.listFolderIds?.());
  };
  let p: Planned;
  try {
    p = plan();
  } catch (e) {
    return fail(message(e));
  }
  if (p.create && !access.createDocument) return fail('Creating documents is not available in this window.');

  if (mode === 'ask') {
    ctx?.onProposal?.({ ...p.change, status: 'pending' });
    const approved = access.requestApproval ? await access.requestApproval(ctx?.callId ?? '') : false;
    if (!approved) {
      return ok(
        'The writer rejected this change. Do not make it again unless they ask; you can ask what they would prefer.',
        { ...p.change, status: 'rejected' },
      );
    }
    try {
      p = plan(); // the writer may have edited while deciding: apply to what is there now
    } catch (e) {
      return fail(`The writer approved, but the document changed in the meantime: ${message(e)} Read it again and retry.`, {
        ...p.change,
        status: 'failed',
        error: message(e),
      });
    }
  }

  try {
    let docId = p.change.docId;
    let before: string | undefined;
    if (p.create) {
      const created = await access.createDocument!(p.create.title, p.create.docType, p.content, p.create.folderId);
      docId = created.id;
    } else {
      before = p.doc!.content;
      await access.applyContent(docId, p.content);
    }
    const change: AiChange = {
      ...p.change,
      docId,
      status: 'applied',
      before,
      afterHash: textHash(contentToText(p.change.docType, p.content)),
    };
    const note = p.create ? ` New document id: ${docId}.` : '';
    return ok(`Applied to "${p.change.docTitle}": ${p.change.summary}.${note}`, change);
  } catch (e) {
    return fail(`The change could not be saved: ${message(e)}`, { ...p.change, status: 'failed', error: message(e) });
  }
}

export async function executeTool(
  name: string,
  rawInput: Record<string, unknown>,
  access: ProjectAccess,
  mode: AiMode,
  ctx?: ToolContext,
): Promise<ToolResult> {
  if (!toolsForMode(mode).some((t) => t.name === name)) {
    return fail(`The tool "${name}" is not available in ${mode} mode.`);
  }
  const input = coerce(rawInput);
  if (WRITE_TOOL_NAMES.has(name)) return executeWrite(name, input, access, mode, ctx);

  access.flush?.();
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
