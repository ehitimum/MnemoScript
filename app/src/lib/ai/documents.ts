import type { Document } from '../../types';

/**
 * Turn project documents into compact plain text for the model. Plain text (not HTML) keeps
 * token use down and is what the edit tools will match against (Phase 3).
 */

const BLOCK_TAGS = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'BLOCKQUOTE', 'PRE', 'DIV', 'TR']);

export function htmlToText(html: string): string {
  if (!html) return '';
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const lines: string[] = [];
  const walk = (node: Node, prefix: string) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType !== Node.ELEMENT_NODE) continue;
      const el = child as HTMLElement;
      if (el.tagName === 'IMG') {
        lines.push(`[image${el.getAttribute('alt') ? `: ${el.getAttribute('alt')}` : ''}]`);
      } else if (el.tagName === 'HR') {
        lines.push('---');
      } else if (el.tagName === 'LI') {
        // A list item holds <p>s (TipTap) and maybe a nested list: text first, then the sub-list.
        const checked = el.getAttribute('data-checked');
        const marker = checked != null ? `- [${checked === 'true' ? 'x' : ' '}] ` : '- ';
        const own = Array.from(el.childNodes)
          .filter((n) => !(n instanceof HTMLElement && (n.tagName === 'UL' || n.tagName === 'OL')))
          .map((n) => n.textContent ?? '')
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim();
        if (own) lines.push(prefix + marker + own);
        for (const sub of Array.from(el.children).filter((c) => c.tagName === 'UL' || c.tagName === 'OL')) {
          walk(sub, `${prefix}  `);
        }
      } else if (BLOCK_TAGS.has(el.tagName) && !el.querySelector(Array.from(BLOCK_TAGS).join(','))) {
        const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
        if (!text) continue;
        const heading = /^H(\d)$/.exec(el.tagName);
        const marker = heading ? `${'#'.repeat(Number(heading[1]))} ` : el.tagName === 'BLOCKQUOTE' ? '> ' : '';
        lines.push(prefix + marker + text);
      } else {
        walk(el, el.tagName === 'BLOCKQUOTE' ? `${prefix}> ` : prefix);
      }
    }
  };
  walk(doc.body, '');
  return lines.join('\n\n');
}

type MindNode = { id: string; data?: { label?: string } };
type MindEdge = { source: string; target: string; label?: string };

export function mindMapToText(content: string): string {
  let parsed: { nodes?: MindNode[]; edges?: MindEdge[] };
  try {
    parsed = JSON.parse(content || '{}');
  } catch {
    return '(This mind map could not be read.)';
  }
  const nodes = parsed.nodes ?? [];
  const label = new Map(nodes.map((n) => [n.id, n.data?.label?.trim() || '(untitled)']));
  const lines = nodes.map((n) => `- [${n.id}] ${label.get(n.id)}`);
  const links = (parsed.edges ?? []).map(
    (e) => `- ${label.get(e.source) ?? e.source} → ${label.get(e.target) ?? e.target}${e.label ? ` (${e.label})` : ''}`,
  );
  return [`Nodes (${nodes.length}):`, ...lines, '', `Links (${links.length}):`, ...links].join('\n');
}

type Named = { id: string; name?: string; text?: string; label?: string; level?: string; kind?: string };

export function fantasyMapToText(content: string): string {
  let m: { title?: string; kind?: string; regions?: Named[]; labels?: Named[]; items?: Named[]; routes?: Named[] };
  try {
    m = JSON.parse(content || '{}');
  } catch {
    return '(This map could not be read.)';
  }
  const regions = (m.regions ?? []).map((r) => `- [${r.id}] ${r.name || '(unnamed)'}${r.level ? ` (${r.level})` : ''}`);
  const labels = (m.labels ?? []).map((l) => `- [${l.id}] ${l.text ?? ''}`);
  const places = (m.items ?? []).filter((i) => i.label).map((i) => `- [${i.id}] ${i.label}`);
  const routes = m.routes ?? [];
  const count = (k: string) => routes.filter((r) => r.kind === k).length;
  return [
    `Map kind: ${m.kind ?? 'world'}${m.title ? ` · title: ${m.title}` : ''}`,
    `Regions (${regions.length}):`, ...regions,
    `Labels (${labels.length}):`, ...labels,
    `Named places (${places.length}):`, ...places,
    `Routes: ${count('road')} roads, ${count('river')} rivers, ${count('border')} borders`,
  ].join('\n');
}

export function documentToText(doc: Document): string {
  switch (doc.docType) {
    case 'mindmap':
      return mindMapToText(doc.content);
    case 'fantasymap':
      return fantasyMapToText(doc.content);
    default:
      return htmlToText(doc.content);
  }
}

export const DOC_KIND_LABEL: Record<Document['docType'], string> = {
  text: 'chapter/note',
  mindmap: 'mind map',
  fantasymap: 'fantasy map',
};
