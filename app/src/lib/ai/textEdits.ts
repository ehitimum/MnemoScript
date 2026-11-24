import { wordDiff } from './diff';
import { BLOCK_TAGS } from './documents';

/**
 * Text edits for chapters and notes. The model sees documents as plain text (`htmlToText`), so
 * an edit is a find → replace on that plain text, applied to the HTML in place: formatting
 * around the edit is kept, a replacement that spans paragraphs works like a selection replace
 * in the editor, and new paragraphs can be written with light markdown (#, -, >, **bold**).
 */

export class EditError extends Error {}

export interface TextEdit {
  find: string;
  replace: string;
}

const BLOCK_SELECTOR = [...BLOCK_TAGS].join(',');
const QUOTES: Record<string, string> = {
  '‘': "'", '’': "'", '‚': "'", '‛': "'",
  '“': '"', '”': '"', '„': '"', '‟': '"',
};
const normChar = (c: string) => QUOTES[c] ?? c;
const MARKER = /^(?:#{1,6}\s+|>\s*|[-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+[.)]\s+)/;

function stripMarkers(line: string): string {
  let out = line;
  for (let m = MARKER.exec(out); m && m[0]; m = MARKER.exec(out)) out = out.slice(m[0].length);
  return out;
}

interface Pos {
  node: Text;
  offset: number;
}

interface Leaf {
  el: HTMLElement;
  /** Whitespace-collapsed text with curly quotes straightened — what `find` is matched against. */
  key: string;
  /** key index → where that character sits in the DOM. */
  map: Pos[];
}

function leafElements(body: HTMLElement): HTMLElement[] {
  return Array.from(body.querySelectorAll<HTMLElement>(BLOCK_SELECTOR)).filter((el) => !el.querySelector(BLOCK_SELECTOR));
}

function buildLeaf(el: HTMLElement): Leaf {
  const map: Pos[] = [];
  let key = '';
  const walker = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
    const s = n.data;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (/\s/.test(c)) {
        if (key === '' || key.endsWith(' ')) continue;
        key += ' ';
      } else {
        key += normChar(c);
      }
      map.push({ node: n, offset: i });
    }
  }
  if (key.endsWith(' ')) {
    key = key.slice(0, -1);
    map.pop();
  }
  return { el, key, map };
}

/** The model's `find`: one line per paragraph, list/heading/quote markers removed. */
function normalizeFind(s: string) {
  const lines = s.replace(/\r\n?/g, '\n').split('\n').map((l) => l.trim()).filter(Boolean);
  const marked = lines.map((l) => stripMarkers(l) !== l);
  const q = lines
    .map((l) => [...stripMarkers(l).replace(/\s+/g, ' ')].map(normChar).join(''))
    .filter(Boolean)
    .join('\n\n');
  return { q, firstMarked: marked[0] ?? false, lastMarked: marked[marked.length - 1] ?? false };
}

const snippet = (s: string) => {
  const one = s.replace(/\s+/g, ' ');
  return one.length > 90 ? `${one.slice(0, 87)}…` : one;
};

/** **bold** and *italic* → nodes; everything else is literal text. */
function inline(doc: globalThis.Document, text: string): DocumentFragment {
  const frag = doc.createDocumentFragment();
  const re = /\*\*([^*]+)\*\*|\*([^*\s][^*]*?)\*/g;
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) frag.append(doc.createTextNode(text.slice(last, m.index)));
    const el = doc.createElement(m[1] != null ? 'strong' : 'em');
    el.textContent = m[1] ?? m[2];
    frag.append(el);
    last = m.index + m[0].length;
  }
  if (last < text.length) frag.append(doc.createTextNode(text.slice(last)));
  return frag;
}

/** Light markdown → TipTap-compatible block elements. */
export function textToBlocks(doc: globalThis.Document, text: string): HTMLElement[] {
  const out: HTMLElement[] = [];
  let list: HTMLElement | null = null;
  let listKind = '';
  let quote: HTMLElement | null = null;
  const el = (tag: string, content?: string) => {
    const e = doc.createElement(tag);
    if (content != null) e.append(inline(doc, content));
    return e;
  };
  const para = (content: string) => el('p', content);
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trim();
    if (!line) {
      list = null;
      quote = null;
      continue;
    }
    let m: RegExpExecArray | null;
    if (/^([-*_])(\s*\1){2,}$/.test(line)) {
      list = quote = null;
      out.push(el('hr'));
    } else if ((m = /^(#{1,6})\s+(.*)$/.exec(line))) {
      list = quote = null;
      out.push(el(`h${Math.min(3, m[1].length)}`, m[2]));
    } else if ((m = /^>\s?(.*)$/.exec(line))) {
      list = null;
      if (!quote) out.push((quote = el('blockquote')));
      quote.append(para(m[1]));
    } else if ((m = /^[-*+]\s+\[([ xX])\]\s+(.*)$/.exec(line)) || (m = /^([-*+])\s+(.*)$/.exec(line)) || (m = /^(\d+)[.)]\s+(.*)$/.exec(line))) {
      quote = null;
      const kind = /^[-*+]\s+\[/.test(line) ? 'task' : /^\d/.test(line) ? 'ol' : 'ul';
      if (!list || listKind !== kind) {
        list = el(kind === 'ol' ? 'ol' : 'ul');
        if (kind === 'task') list.setAttribute('data-type', 'taskList');
        listKind = kind;
        out.push(list);
      }
      const li = el('li');
      if (kind === 'task') {
        li.setAttribute('data-type', 'taskItem');
        li.setAttribute('data-checked', m[1].toLowerCase() === 'x' ? 'true' : 'false');
      }
      li.append(para(m[2]));
      list.append(li);
    } else {
      list = quote = null;
      out.push(para(line));
    }
  }
  return out;
}

export function textToHtml(text: string): string {
  const doc = new DOMParser().parseFromString('<body></body>', 'text/html');
  doc.body.append(...textToBlocks(doc, text));
  return doc.body.innerHTML;
}

const hasContent = (el: Element | DocumentFragment) => (el.textContent ?? '').trim() !== '' || !!el.querySelector('img,hr');

/** Empty <strong>/<em>/… shells left behind by splitting a match out of formatted text. */
function dropEmptyInlines(el: HTMLElement) {
  for (const n of Array.from(el.querySelectorAll('strong,b,em,i,u,s,mark,code,span,a,sub,sup'))) {
    if (!n.textContent && !n.querySelector('img,br')) n.remove();
  }
}

/** Remove a block and any wrapper (list item, list, quote) it leaves empty. */
function removeBlock(el: HTMLElement, body: HTMLElement) {
  let node: HTMLElement | null = el;
  while (node && node !== body) {
    const parent: HTMLElement | null = node.parentElement;
    node.remove();
    if (!parent || parent === body || hasContent(parent)) break;
    node = parent;
  }
}

/** Insert new paragraphs after `anchor`, in the same kind of container (list item, quote, page). */
function insertAfter(anchor: HTMLElement, body: HTMLElement, lines: string[], tail: { tag: string; nodes: DocumentFragment } | null) {
  const doc = body.ownerDocument;
  const li = anchor.closest('li');
  const units: HTMLElement[] = [];
  if (li && body.contains(li)) {
    const mk = (content: DocumentFragment) => {
      const n = li.cloneNode(false) as HTMLElement;
      if (n.hasAttribute('data-checked')) n.setAttribute('data-checked', 'false');
      const p = doc.createElement('p');
      p.append(content);
      n.append(p);
      return n;
    };
    for (const l of lines) units.push(mk(inline(doc, stripMarkers(l))));
    if (tail) units.push(mk(tail.nodes));
    let ref: HTMLElement = li;
    for (const u of units) {
      ref.after(u);
      ref = u;
    }
    return;
  }
  if (anchor.parentElement === body) {
    units.push(...textToBlocks(doc, lines.join('\n')));
  } else {
    for (const l of lines) {
      const p = doc.createElement('p');
      p.append(inline(doc, stripMarkers(l)));
      units.push(p);
    }
  }
  if (tail) {
    const t = doc.createElement(tail.tag);
    t.append(tail.nodes);
    units.push(t);
  }
  anchor.after(...units);
}

function applyOne(body: HTMLElement, edit: TextEdit, index: number) {
  const doc = body.ownerDocument;
  const label = `Edit ${index + 1}`;
  if (typeof edit?.find !== 'string' || typeof edit?.replace !== 'string') {
    throw new EditError(`${label}: each edit needs "find" and "replace" strings.`);
  }
  const all = leafElements(body).map(buildLeaf);
  const leaves = all.filter((l) => l.key.length > 0);
  const starts: number[] = [];
  let flat = '';
  leaves.forEach((l, i) => {
    if (i) flat += '\n\n';
    starts.push(flat.length);
    flat += l.key;
  });

  const { q, firstMarked, lastMarked } = normalizeFind(edit.find);
  if (!q) throw new EditError(`${label}: "find" is empty. To add text, include the neighbouring sentence in both "find" and "replace".`);
  const at = flat.indexOf(q);
  if (at < 0) {
    throw new EditError(
      `${label}: this text is not in the document: "${snippet(q)}". Copy "find" exactly from read_document ` +
        '(edits earlier in the same call are already applied).',
    );
  }
  let count = 1;
  for (let i = flat.indexOf(q, at + 1); i >= 0; i = flat.indexOf(q, i + 1)) count++;
  if (count > 1) {
    throw new EditError(`${label}: this text appears ${count} times: "${snippet(q)}". Add neighbouring words so it matches once.`);
  }
  const end = at + q.length;
  let si = 0;
  let ei = 0;
  starts.forEach((s, i) => {
    if (s <= at) si = i;
    if (s < end) ei = i;
  });
  const sLeaf = leaves[si];
  const eLeaf = leaves[ei];
  const so = at - starts[si];
  const eo = end - starts[ei];
  const startPos = sLeaf.map[so];
  const endChar = eLeaf.map[eo - 1];

  const parts = edit.replace.replace(/\r\n?/g, '\n').split('\n').map((l) => l.trim()).filter(Boolean);
  if (parts.length && firstMarked) parts[0] = stripMarkers(parts[0]);
  if (parts.length > 1 && lastMarked) parts[parts.length - 1] = stripMarkers(parts[parts.length - 1]);

  // Within one paragraph, change only the words that differ, so bold/italic on the words the
  // model kept stay exactly as they were.
  if (si === ei && parts.length === 1) {
    replaceWords(sLeaf, so, wordDiff(q, parts[0]));
    dropEmptyInlines(sLeaf.el);
    if (!hasContent(sLeaf.el)) removeBlock(sLeaf.el, body);
    return;
  }

  // 1. Lift out what follows the match in the last paragraph.
  const tailRange = doc.createRange();
  tailRange.setStart(endChar.node, endChar.offset + 1);
  tailRange.setEnd(eLeaf.el, eLeaf.el.childNodes.length);
  const tail = tailRange.extractContents();
  // 2. Delete from the match start to the end of the first paragraph.
  const del = doc.createRange();
  del.setStart(startPos.node, startPos.offset);
  del.setEnd(sLeaf.el, sLeaf.el.childNodes.length);
  del.deleteContents();
  // deleteContents collapses to the paragraph level when the match began inside <strong> etc.;
  // insert where the match began instead, so the new text keeps that formatting.
  const at0 = doc.createRange();
  if (startPos.node.isConnected) at0.setStart(startPos.node, Math.min(startPos.offset, startPos.node.length));
  else at0.setStart(del.startContainer, del.startOffset);
  at0.collapse(true);
  // 3. Paragraphs fully inside the match go (including blank ones between).
  const iS = all.findIndex((l) => l.el === sLeaf.el);
  const iE = all.findIndex((l) => l.el === eLeaf.el);
  const between = all.slice(iS + 1, iE).map((l) => l.el);

  const tailHasText = hasContent(tail);
  if (parts.length <= 1) {
    // Insert where the match started, so it keeps the formatting it had (bold stays bold).
    if (parts[0]) at0.insertNode(inline(doc, parts[0]));
    sLeaf.el.append(tail);
    if (eLeaf.el !== sLeaf.el) between.push(eLeaf.el);
  } else {
    at0.insertNode(inline(doc, parts[0]));
    const last = parts[parts.length - 1];
    const middle = parts.slice(1, -1);
    if (eLeaf.el !== sLeaf.el) {
      eLeaf.el.replaceChildren(inline(doc, last), tail);
      insertAfter(sLeaf.el, body, middle, null);
    } else if (tailHasText) {
      const nodes = inline(doc, last);
      nodes.append(tail);
      insertAfter(sLeaf.el, body, middle, { tag: sLeaf.el.tagName === 'LI' ? 'p' : /^H\d$/.test(sLeaf.el.tagName) ? 'p' : sLeaf.el.tagName.toLowerCase(), nodes });
    } else {
      insertAfter(sLeaf.el, body, [...middle, last], null);
    }
  }
  for (const el of between) removeBlock(el, body);
  for (const leaf of [sLeaf.el, eLeaf.el]) if (leaf.isConnected) dropEmptyInlines(leaf);
  if (!hasContent(sLeaf.el)) removeBlock(sLeaf.el, body);
  if (eLeaf.el !== sLeaf.el && eLeaf.el.isConnected && !hasContent(eLeaf.el)) removeBlock(eLeaf.el, body);
}

/** Apply a word diff to one paragraph, starting at key offset `from`, back to front. */
function replaceWords(leaf: Leaf, from: number, ops: ReturnType<typeof wordDiff>) {
  const doc = leaf.el.ownerDocument;
  const chunks: { a: number; b: number; text: string }[] = [];
  let cur: { a: number; b: number; text: string } | null = null;
  let pos = from;
  for (const op of ops) {
    if (op.type === 'eq') {
      if (cur) chunks.push(cur);
      cur = null;
      pos += op.text.length;
      continue;
    }
    cur ??= { a: pos, b: pos, text: '' };
    if (op.type === 'del') {
      pos += op.text.length;
      cur.b = pos;
    } else {
      cur.text += op.text;
    }
  }
  if (cur) chunks.push(cur);
  const after = (i: number) => ({ node: leaf.map[i].node, offset: leaf.map[i].offset + 1 });
  for (const c of chunks.reverse()) {
    const r = doc.createRange();
    if (c.a < c.b) {
      const start = leaf.map[c.a];
      const end = after(c.b - 1);
      r.setStart(start.node, start.offset);
      r.setEnd(end.node, end.offset);
      r.deleteContents();
      if (start.node.isConnected) r.setStart(start.node, Math.min(start.offset, start.node.length));
      r.collapse(true);
    } else {
      // Pure insertion: attach to the text before it (as typing would).
      const p = c.a > 0 ? after(c.a - 1) : leaf.map[c.a];
      r.setStart(p.node, p.offset);
      r.collapse(true);
    }
    if (c.text) r.insertNode(inline(doc, c.text));
  }
}

/** Apply edits in order (each sees the previous ones). All-or-nothing: throws `EditError`. */
export function applyTextEdits(html: string, edits: TextEdit[]): string {
  if (!Array.isArray(edits) || !edits.length) throw new EditError('"edits" must be a non-empty list of { find, replace }.');
  const doc = new DOMParser().parseFromString(`<body>${html || ''}</body>`, 'text/html');
  edits.forEach((e, i) => applyOne(doc.body, e, i));
  return doc.body.innerHTML;
}
