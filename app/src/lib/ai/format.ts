import type { Document } from '../../types';
import type { AiToolCallRecord } from './types';

/** "just now", "5 min ago", "2 h ago", "Yesterday", "Mon", "Oct 28". */
export function relativeTime(iso: string, now: Date = new Date()): string {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return '';
  const mins = Math.round((now.getTime() - t.getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (t.getTime() >= startOfToday) return `${Math.round(mins / 60)} h ago`;
  if (t.getTime() >= startOfToday - 86400000) return 'Yesterday';
  if (t.getTime() >= startOfToday - 6 * 86400000) return t.toLocaleDateString(undefined, { weekday: 'short' });
  return t.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** Human description of a tool call for the chat transcript. */
export function describeToolCall(call: AiToolCallRecord, docs: Document[]): string {
  const id = typeof call.input.id === 'string' ? call.input.id : '';
  const title = docs.find((d) => d.id === id)?.title;
  switch (call.name) {
    case 'list_documents':
      return 'Looked through the project';
    case 'read_document':
      return title ? `Read “${title}”` : 'Read a document';
    default:
      return call.name.replace(/_/g, ' ');
  }
}

/** "Resets in 2 h 14 min" / "Resets Thu 9:00". */
export function resetsIn(unixSeconds: number, now: Date = new Date()): string {
  const ms = unixSeconds * 1000 - now.getTime();
  if (ms <= 0) return 'Resets now';
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `Resets in ${mins} min`;
  if (mins < 24 * 60) return `Resets in ${Math.floor(mins / 60)} h ${mins % 60} min`;
  return `Resets ${new Date(unixSeconds * 1000).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}`;
}
