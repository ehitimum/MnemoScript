/**
 * AI assistant types. The wire types (`AiEvent`, `AiTurnRequest`, `CliStatus`) mirror
 * `src-tauri/src/ai/types.rs`; the session types are owned here and stored opaquely by the
 * backend in `<project>/ai/sessions/<id>.json`.
 */

/** How MnemoScript reaches the model. One provider is connected per project at a time. */
export type AiProviderId = 'claude-code' | 'anthropic' | 'openai' | 'gemini';
export type ApiKeyProvider = 'anthropic' | 'openai' | 'gemini';

/** plan = read-only, ask = edits need approval, auto = edits apply (with undo). */
export type AiMode = 'plan' | 'ask' | 'auto';

/** Saved on the project (`project.json` → `ai`). */
export interface ProjectAiConfig {
  provider: AiProviderId;
  /** Model id or CLI alias; '' = the provider's / plan's default. Switchable per message. */
  model: string;
  mode: AiMode;
}

export interface AiToolCallRecord {
  callId: string;
  name: string;
  input: Record<string, unknown>;
  result?: string;
  isError?: boolean;
  /** Set for write tools: what the AI changed (or proposed), for the change card and undo. */
  change?: AiChange;
}

export type AiChangeStatus = 'pending' | 'applied' | 'rejected' | 'undone' | 'failed';

export type AiChangePreview =
  | { kind: 'text'; hunks: { before: string; after: string }[] }
  | { kind: 'list'; lines: { op: 'add' | 'remove' | 'change'; text: string }[] };

export interface AiChange {
  docId: string;
  docTitle: string;
  docType: 'text' | 'mindmap' | 'fantasymap';
  /** One line, e.g. "3 edits" or "New chapter". */
  summary: string;
  preview: AiChangePreview;
  /** create_document: undo deletes the document instead of restoring content. */
  created?: boolean;
  status: AiChangeStatus;
  /** Content before the change (kept while it can still be undone). */
  before?: string;
  /** Fingerprint of the text right after the change, to warn when undo would discard later edits. */
  afterHash?: string;
  error?: string;
}

export interface AiUsage {
  inputTokens: number;
  outputTokens: number;
  costUsd?: number | null;
}

export interface AiMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  createdAt: string;
  provider?: AiProviderId;
  /** The model that actually answered (resolved, e.g. `claude-sonnet-5`). */
  model?: string;
  mode?: AiMode;
  toolCalls?: AiToolCallRecord[];
  usage?: AiUsage;
  error?: { kind: AiErrorKind; message: string };
  /** True while the reply is still streaming. Never persisted as true. */
  pending?: boolean;
}

export interface AiSession {
  version: 1;
  id: string;
  title: string;
  /** Provider of the latest turn. */
  provider: AiProviderId;
  /** Every model that has answered here, newest first (drives the session's model icons). */
  models: string[];
  createdAt: string;
  updatedAt: string;
  messages: AiMessage[];
}

export interface AiSessionSummary {
  id: string;
  title: string;
  provider: AiProviderId | '';
  models: string[];
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

export interface AiToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface AiTurnRequest {
  turnId: string;
  provider: AiProviderId;
  model: string;
  system: string;
  messages: { role: 'user' | 'assistant'; content: string }[];
  tools: AiToolSpec[];
  effort?: string;
}

export type AiErrorKind =
  | 'auth'
  | 'rate_limit'
  | 'refusal'
  | 'unavailable'
  | 'cancelled'
  | 'network'
  | 'provider';

export type AiEvent =
  | { type: 'started'; model: string }
  | { type: 'textDelta'; text: string }
  | { type: 'toolCall'; callId: string; name: string; input: Record<string, unknown> }
  | { type: 'usage'; inputTokens: number; outputTokens: number; costUsd: number | null }
  | { type: 'rateLimit'; window: string; status: string; resetsAt: number | null; utilization: number | null }
  | { type: 'done'; stopReason: string }
  | { type: 'error'; kind: AiErrorKind; message: string };

/** Claude Code CLI status (Settings → AI). */
export interface CliStatus {
  installed: boolean;
  version?: string | null;
  loggedIn: boolean;
  authMethod?: string | null;
  email?: string | null;
  orgName?: string | null;
  plan?: string | null;
}

export type KeyStatus = Record<ApiKeyProvider, boolean>;
