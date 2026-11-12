import type { DocType } from '../../types';

/**
 * Plain paragraphs for the conflict preview. HTML is parsed inertly by DOMParser (no scripts
 * run, no images load) and only text is shown, so a version from another device can never
 * inject markup into the app.
 */
export function paragraphs(content: string, docType: DocType): string[] {
  if (docType !== 'text') {
    try {
      const graph = JSON.parse(content) as Record<string, unknown>;
      const count = (k: string) => (Array.isArray(graph[k]) ? (graph[k] as unknown[]).length : 0);
      return docType === 'mindmap'
        ? [`${count('nodes')} ideas · ${count('edges')} links`]
        : [`${count('regions')} regions · ${count('items')} map items · ${count('labels')} labels`];
    } catch {
      return ['(This version could not be previewed)'];
    }
  }
  const doc = new DOMParser().parseFromString(content, 'text/html');
  const blocks = Array.from(doc.body.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, blockquote, pre'))
    .filter((el) => !el.querySelector('p, li'))
    .map((el) => (el.textContent ?? '').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  return blocks.length ? blocks : [(doc.body.textContent ?? '').trim() || '(Empty)'];
}

export function wordCount(ps: string[]): number {
  return ps.join(' ').split(/\s+/).filter(Boolean).length;
}
