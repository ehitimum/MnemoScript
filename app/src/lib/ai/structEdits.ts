import { EditError } from './textEdits';

/**
 * Mind-map and fantasy-map edits. Both are JSON documents; edits touch only what they name and
 * keep every other field (positions, colours, terrain…) exactly as it was.
 */

export interface ListLine {
  op: 'add' | 'remove' | 'change';
  text: string;
}

export interface StructResult {
  content: string;
  lines: ListLine[];
}

const q = (s: string) => `“${s}”`;
const shortId = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10);
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const list = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

// ── Mind maps ──────────────────────────────────────────────────────────────

type XY = { x: number; y: number };
interface MindNode {
  id: string;
  type?: string;
  position: XY;
  data: { label: string; color?: string; shape?: string; [k: string]: unknown };
  [k: string]: unknown;
}
interface MindEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  [k: string]: unknown;
}

const PALETTE = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#a855f7'];
const NODE_W = 190;
const NODE_H = 90;

export interface MindMapEditInput {
  add_nodes?: { ref?: string; label: string; parent?: string; link_label?: string }[];
  rename_nodes?: { id: string; label: string }[];
  remove_nodes?: string[];
  add_links?: { from: string; to: string; label?: string }[];
  remove_links?: { from: string; to: string }[];
}

function anchor(a: XY, b: XY) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.abs(dy) >= Math.abs(dx)
    ? { sourceHandle: dy >= 0 ? 'bottom' : 'top', targetHandle: dy >= 0 ? 'top' : 'bottom' }
    : { sourceHandle: dx >= 0 ? 'right' : 'left', targetHandle: dx >= 0 ? 'left' : 'right' };
}

export function applyMindMapEdit(content: string, input: MindMapEditInput): StructResult {
  let parsed: { nodes?: MindNode[]; edges?: MindEdge[]; [k: string]: unknown };
  try {
    parsed = JSON.parse(content || '{}');
  } catch {
    throw new EditError('This mind map could not be read, so it cannot be edited.');
  }
  const nodes: MindNode[] = list<MindNode>(parsed.nodes).map((n) => ({ ...n, data: { ...n.data } }));
  let edges: MindEdge[] = list<MindEdge>(parsed.edges).map((e) => ({ ...e }));
  const lines: ListLine[] = [];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const name = (id: string) => byId.get(id)?.data.label?.trim() || '(untitled)';
  const need = (id: string, what: string) => {
    const n = byId.get(id);
    if (!n) throw new EditError(`${what}: no node has the id "${id}". Use the [ids] from read_document, or a "ref" you gave a new node.`);
    return n;
  };

  for (const r of list<{ id: string; label: string }>(input.rename_nodes)) {
    const n = need(str(r.id), 'rename_nodes');
    const label = str(r.label);
    if (!label) throw new EditError('rename_nodes: "label" cannot be empty.');
    lines.push({ op: 'change', text: `${q(name(n.id))} → ${q(label)}` });
    n.data.label = label;
  }

  for (const id of list<string>(input.remove_nodes).map(str)) {
    need(id, 'remove_nodes');
    lines.push({ op: 'remove', text: `Node ${q(name(id))}` });
    byId.delete(id);
    edges = edges.filter((e) => e.source !== id && e.target !== id);
  }

  const occupied = (p: XY) =>
    [...byId.values()].some((n) => Math.abs(n.position.x - p.x) < NODE_W - 20 && Math.abs(n.position.y - p.y) < NODE_H - 20);
  const free = (p: XY, step: XY) => {
    const c = { ...p };
    for (let i = 0; i < 40 && occupied(c); i++) {
      c.x += step.x;
      c.y += step.y;
    }
    return c;
  };
  const link = (from: MindNode, to: MindNode, label?: string) => {
    const e: MindEdge = {
      id: `ai-e-${shortId()}`,
      source: from.id,
      target: to.id,
      animated: true,
      ...anchor(from.position, to.position),
    };
    if (label) e.label = label;
    edges.push(e);
  };

  const refs = new Map<string, string>();
  const resolve = (v: string) => refs.get(v) ?? v;
  let k = 0;
  for (const a of list<{ ref?: string; label: string; parent?: string; link_label?: string }>(input.add_nodes)) {
    const label = str(a.label);
    if (!label) throw new EditError('add_nodes: every node needs a "label".');
    const parentKey = str(a.parent);
    const parent = parentKey ? need(resolve(parentKey), 'add_nodes.parent') : null;
    let position: XY;
    if (parent) {
      position = free({ x: parent.position.x, y: parent.position.y + NODE_H + 60 }, { x: NODE_W + 20, y: 0 });
    } else {
      const all = [...byId.values()];
      const maxX = all.length ? Math.max(...all.map((n) => n.position.x)) : 0;
      const minY = all.length ? Math.min(...all.map((n) => n.position.y)) : 0;
      position = free({ x: all.length ? maxX + NODE_W + 60 : 0, y: minY }, { x: 0, y: NODE_H + 20 });
    }
    const node: MindNode = {
      id: `ai-${shortId()}`,
      type: 'editable',
      position,
      data: {
        label,
        color: parent?.data.color ?? PALETTE[(nodes.length + k++) % PALETTE.length],
        ...(parent?.data.shape ? { shape: parent.data.shape } : {}),
      },
    };
    byId.set(node.id, node);
    if (a.ref) refs.set(str(a.ref), node.id);
    lines.push({ op: 'add', text: parent ? `Node ${q(label)} under ${q(name(parent.id))}` : `Node ${q(label)}` });
    if (parent) link(parent, node, str(a.link_label) || undefined);
  }

  for (const l of list<{ from: string; to: string; label?: string }>(input.add_links)) {
    const from = need(resolve(str(l.from)), 'add_links.from');
    const to = need(resolve(str(l.to)), 'add_links.to');
    if (from.id === to.id) throw new EditError('add_links: a node cannot link to itself.');
    lines.push({ op: 'add', text: `Link ${q(name(from.id))} → ${q(name(to.id))}${l.label ? ` (${l.label})` : ''}` });
    link(from, to, str(l.label) || undefined);
  }

  for (const l of list<{ from: string; to: string }>(input.remove_links)) {
    const from = resolve(str(l.from));
    const to = resolve(str(l.to));
    const before = edges.length;
    edges = edges.filter((e) => !((e.source === from && e.target === to) || (e.source === to && e.target === from)));
    if (edges.length === before) throw new EditError(`remove_links: there is no link between "${from}" and "${to}".`);
    lines.push({ op: 'remove', text: `Link ${q(name(from))} → ${q(name(to))}` });
  }

  if (!lines.length) throw new EditError('Nothing to change: give at least one of add_nodes, rename_nodes, remove_nodes, add_links, remove_links.');
  const kept = nodes.filter((n) => byId.has(n.id));
  const added = [...byId.values()].filter((n) => !nodes.includes(n));
  return { content: JSON.stringify({ ...parsed, nodes: [...kept, ...added], edges }), lines };
}

/** A new mind map for create_document: a central node, optionally with first-level ideas. */
export function newMindMap(title: string, ideas: string[] = []): string {
  const root = { id: 'ai-root', type: 'editable', position: { x: 0, y: 0 }, data: { label: title, color: PALETTE[0] } };
  const start = JSON.stringify({ nodes: [root], edges: [] });
  const clean = ideas.map((s) => s.trim()).filter(Boolean);
  return clean.length ? applyMindMapEdit(start, { add_nodes: clean.map((label) => ({ label, parent: 'ai-root' })) }).content : start;
}

// ── Fantasy maps ───────────────────────────────────────────────────────────

interface MapRegionLike {
  id: string;
  name: string;
  points: number[];
  labelPos?: XY;
  [k: string]: unknown;
}
interface MapItemLike {
  id: string;
  x: number;
  y: number;
  label?: string;
  [k: string]: unknown;
}
interface MapLabelLike {
  id: string;
  text: string;
  x: number;
  y: number;
  [k: string]: unknown;
}

export interface FantasyMapEditInput {
  rename_regions?: { id: string; name: string }[];
  rename_places?: { id: string; label: string }[];
  edit_labels?: { id: string; text: string }[];
  add_labels?: { text: string; near?: string; size?: number }[];
  remove_labels?: string[];
}

function centroid(points: number[]): XY {
  let x = 0;
  let y = 0;
  const n = Math.floor(points.length / 2);
  for (let i = 0; i < n; i++) {
    x += points[i * 2];
    y += points[i * 2 + 1];
  }
  return n ? { x: x / n, y: y / n } : { x: 0, y: 0 };
}

export function applyFantasyMapEdit(content: string, input: FantasyMapEditInput): StructResult {
  let m: {
    regions?: MapRegionLike[];
    items?: MapItemLike[];
    labels?: MapLabelLike[];
    canvas?: { width?: number; height?: number };
    [k: string]: unknown;
  };
  try {
    m = JSON.parse(content || '{}');
  } catch {
    throw new EditError('This map could not be read, so it cannot be edited.');
  }
  const regions = list<MapRegionLike>(m.regions).map((r) => ({ ...r }));
  const items = list<MapItemLike>(m.items).map((i) => ({ ...i }));
  let labels = list<MapLabelLike>(m.labels).map((l) => ({ ...l }));
  const lines: ListLine[] = [];
  const find = <T extends { id: string }>(arr: T[], id: string, what: string) => {
    const hit = arr.find((x) => x.id === id);
    if (!hit) throw new EditError(`${what}: nothing on this map has the id "${id}". Use the [ids] from read_document.`);
    return hit;
  };

  for (const r of list<{ id: string; name: string }>(input.rename_regions)) {
    const region = find(regions, str(r.id), 'rename_regions');
    const nm = str(r.name);
    if (!nm) throw new EditError('rename_regions: "name" cannot be empty.');
    lines.push({ op: 'change', text: `Region ${q(region.name || '(unnamed)')} → ${q(nm)}` });
    region.name = nm;
  }
  for (const p of list<{ id: string; label: string }>(input.rename_places)) {
    const item = find(items, str(p.id), 'rename_places');
    const label = str(p.label);
    lines.push(
      label
        ? { op: 'change', text: `Place ${q(item.label || '(unnamed)')} → ${q(label)}` }
        : { op: 'remove', text: `Caption ${q(item.label || '')}` },
    );
    if (label) item.label = label;
    else delete item.label;
  }
  for (const e of list<{ id: string; text: string }>(input.edit_labels)) {
    const label = find(labels, str(e.id), 'edit_labels');
    const text = str(e.text);
    if (!text) throw new EditError('edit_labels: "text" cannot be empty (use remove_labels to delete one).');
    lines.push({ op: 'change', text: `Label ${q(label.text)} → ${q(text)}` });
    label.text = text;
  }
  for (const id of list<string>(input.remove_labels).map(str)) {
    const label = find(labels, id, 'remove_labels');
    lines.push({ op: 'remove', text: `Label ${q(label.text)}` });
    labels = labels.filter((l) => l.id !== id);
  }
  for (const a of list<{ text: string; near?: string; size?: number }>(input.add_labels)) {
    const text = str(a.text);
    if (!text) throw new EditError('add_labels: every label needs "text".');
    const near = str(a.near);
    let at: XY = { x: (m.canvas?.width ?? 1600) / 2, y: (m.canvas?.height ?? 1000) / 2 };
    let where = '';
    if (near) {
      const region = regions.find((r) => r.id === near);
      const item = items.find((i) => i.id === near);
      if (region) {
        at = region.labelPos ?? centroid(region.points);
        at = { x: at.x, y: at.y + 34 };
        where = ` in ${q(region.name)}`;
      } else if (item) {
        at = { x: item.x, y: item.y - 40 };
        where = ` by ${q(item.label || 'a place')}`;
      } else {
        throw new EditError(`add_labels: "near" must be a region or place id from read_document, not "${near}".`);
      }
    }
    const size = typeof a.size === 'number' && a.size >= 8 && a.size <= 96 ? Math.round(a.size) : 22;
    const color = m.style === 'handdrawn' ? '#9e2b25' : '#3a2f23'; // same as a label placed by hand
    labels.push({ id: `lb_ai${shortId()}`, text, x: Math.round(at.x), y: Math.round(at.y), size, color, rotation: 0, bold: true });
    lines.push({ op: 'add', text: `Label ${q(text)}${where}` });
  }

  if (!lines.length) {
    throw new EditError('Nothing to change: give at least one of rename_regions, rename_places, edit_labels, add_labels, remove_labels.');
  }
  return { content: JSON.stringify({ ...m, regions, items, labels }), lines };
}
