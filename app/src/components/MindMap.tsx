import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import dagre from '@dagrejs/dagre';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  addEdge,
  Handle,
  Position,
  ConnectionMode,
  useReactFlow,
  type Node,
  type Edge,
  type Connection,
  type NodeProps,
  type NodeTypes,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { Document } from '../types';
import type { ThemeType } from '../App';
import {
  Save,
  Wand2,
  ChevronDown,
  Undo2,
  Redo2,
  Network,
  Workflow,
  Wind,
  RectangleHorizontal,
  Square,
  Squircle,
  Circle,
  Diamond,
  List,
  ListOrdered,
  Minus,
  CheckSquare,
  type LucideIcon,
} from 'lucide-react';

type ShapeId = 'rect' | 'rounded' | 'square' | 'circle' | 'diamond';
type MindNodeData = { label: string; color: string; shape?: ShapeId };
type MindNode = Node<MindNodeData>;

const PALETTE = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#a855f7'];

const SHAPES: { id: ShapeId; label: string; Icon: LucideIcon }[] = [
  { id: 'rect', label: 'Rectangle', Icon: RectangleHorizontal },
  { id: 'rounded', label: 'Rounded', Icon: Squircle },
  { id: 'square', label: 'Square', Icon: Square },
  { id: 'circle', label: 'Circle', Icon: Circle },
  { id: 'diamond', label: 'Diamond', Icon: Diamond },
];

// Quick-insert list prefixes triggered by typing "/" inside a node. Each item is
// indented two spaces so the list visually nests under the surrounding text.
type SlashItem = {
  id: string;
  title: string;
  description: string;
  icon: LucideIcon;
  keywords: string[];
  // `value` is the full text before the slash on the current line; used to
  // auto-number ordered lists from the preceding line.
  make: (value: string, slashIndex: number) => string;
};

const INDENT = '  ';

const SLASH_ITEMS: SlashItem[] = [
  {
    id: 'bullet',
    title: 'Bullet point',
    description: 'Unordered list item',
    icon: List,
    keywords: ['bullet', 'ul', 'unordered', 'dot'],
    make: () => `${INDENT}• `,
  },
  {
    id: 'number',
    title: 'Numbered point',
    description: 'Auto-incrementing list item',
    icon: ListOrdered,
    keywords: ['number', 'ordered', 'ol', '1'],
    make: (value, slashIndex) => `${INDENT}${nextOrdinal(value, slashIndex)}. `,
  },
  {
    id: 'dash',
    title: 'Dash',
    description: 'Simple dash item',
    icon: Minus,
    keywords: ['dash', 'hyphen', 'line'],
    make: () => `${INDENT}– `,
  },
  {
    id: 'todo',
    title: 'Checkbox',
    description: 'To-do item',
    icon: CheckSquare,
    keywords: ['todo', 'task', 'check', 'box'],
    make: () => `${INDENT}☐ `,
  },
];

/** Look at the line above the slash to continue numbered lists (1, 2, 3…). */
function nextOrdinal(value: string, slashIndex: number): number {
  const lineStart = value.lastIndexOf('\n', slashIndex - 1) + 1;
  if (lineStart === 0) return 1;
  const prevLineStart = value.lastIndexOf('\n', lineStart - 2) + 1;
  const prevLine = value.slice(prevLineStart, lineStart - 1);
  const m = prevLine.match(/^\s*(\d+)[.)]/);
  return m ? parseInt(m[1], 10) + 1 : 1;
}

// One handle per side. Connection mode is "loose" (see <ReactFlow>), so any
// handle can act as both the start and end of an edge regardless of `type`.
const HANDLES: { id: string; position: Position }[] = [
  { id: 'top', position: Position.Top },
  { id: 'right', position: Position.Right },
  { id: 'bottom', position: Position.Bottom },
  { id: 'left', position: Position.Left },
];

type SlashState = { open: boolean; slashIndex: number; query: string; x: number; y: number; active: number };
const SLASH_CLOSED: SlashState = { open: false, slashIndex: -1, query: '', x: 0, y: 0, active: 0 };

function EditableNode({ id, data, selected }: NodeProps<MindNode>) {
  const { setNodes } = useReactFlow<MindNode>();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(data.label);
  const [slash, setSlash] = useState<SlashState>(SLASH_CLOSED);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const shape = data.shape ?? 'rect';

  const matches = slash.open
    ? SLASH_ITEMS.filter(
        (it) =>
          !slash.query ||
          it.title.toLowerCase().includes(slash.query.toLowerCase()) ||
          it.keywords.some((k) => k.startsWith(slash.query.toLowerCase())),
      )
    : [];

  const startEdit = () => {
    setDraft(data.label);
    setEditing(true);
  };

  const commit = () => {
    setEditing(false);
    setSlash(SLASH_CLOSED);
    setNodes((nds) => nds.map((n) => (n.id === id ? { ...n, data: { ...n.data, label: draft } } : n)));
  };

  // Grow the textarea to fit its content (so the node expands with the notes).
  const autoSize = () => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  };
  useEffect(() => {
    if (editing) {
      autoSize();
      taRef.current?.select();
    }
  }, [editing]);

  // Detect a "/" trigger: a slash at line start or after whitespace, with the
  // caret still on the contiguous query that follows it.
  const syncSlash = (value: string, caret: number) => {
    const before = value.slice(0, caret);
    const slashIndex = before.lastIndexOf('/');
    if (slashIndex === -1) return setSlash(SLASH_CLOSED);
    const prev = slashIndex === 0 ? '\n' : before[slashIndex - 1];
    const query = before.slice(slashIndex + 1);
    if (!/\s/.test(prev) || /\s/.test(query)) return setSlash(SLASH_CLOSED);
    const rect = taRef.current?.getBoundingClientRect();
    setSlash((s) => ({
      open: true,
      slashIndex,
      query,
      x: rect ? rect.left : s.x,
      y: rect ? rect.bottom + 6 : s.y,
      active: 0,
    }));
  };

  const applySlash = (item: SlashItem) => {
    const el = taRef.current;
    const value = draft;
    const start = slash.slashIndex;
    const end = start + 1 + slash.query.length;
    const insert = item.make(value, start);
    const next = value.slice(0, start) + insert + value.slice(end);
    setDraft(next);
    setSlash(SLASH_CLOSED);
    const caret = start + insert.length;
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      el.setSelectionRange(caret, caret);
      autoSize();
    });
  };

  return (
    <div
      className={`mindmap-node shape-${shape}${selected ? ' is-selected' : ''}`}
      style={{ background: shape === 'diamond' ? 'transparent' : data.color, ['--node-color' as string]: data.color }}
      onDoubleClick={startEdit}
    >
      {/* Diamond is a rotated square "face" rather than a clip-path, so the
          handles and selection ring (on the container) are never cut off. */}
      {shape === 'diamond' && <div className="mindmap-diamond-face" aria-hidden />}
      {HANDLES.map((h) => (
        <Handle key={h.id} id={h.id} type="source" position={h.position} className="mindmap-handle" />
      ))}
      {editing ? (
        <textarea
          ref={taRef}
          autoFocus
          rows={1}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            autoSize();
            syncSlash(e.target.value, e.target.selectionStart);
          }}
          onClick={(e) => syncSlash(draft, e.currentTarget.selectionStart)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (slash.open && matches.length) {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                return setSlash((s) => ({ ...s, active: (s.active + 1) % matches.length }));
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault();
                return setSlash((s) => ({ ...s, active: (s.active - 1 + matches.length) % matches.length }));
              }
              if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault();
                return applySlash(matches[slash.active] ?? matches[0]);
              }
              if (e.key === 'Escape') {
                e.preventDefault();
                return setSlash(SLASH_CLOSED);
              }
            }
            // Enter commits; Shift+Enter inserts a newline (default behaviour).
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              commit();
            }
            if (e.key === 'Escape') setEditing(false);
          }}
          className="mindmap-node-input nodrag nowheel"
        />
      ) : (
        <span className="mindmap-node-label">{data.label || 'Untitled'}</span>
      )}

      {slash.open && matches.length > 0 && createPortal(
        <div
          className="slash-popup nodrag nowheel"
          style={{ left: slash.x, top: slash.y }}
          onMouseDown={(e) => e.preventDefault()}
        >
          <div className="slash-menu">
            {matches.map((item, i) => {
              const Icon = item.icon;
              const active = i === slash.active;
              return (
                <button
                  key={item.id}
                  type="button"
                  onMouseEnter={() => setSlash((s) => ({ ...s, active: i }))}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    applySlash(item);
                  }}
                  className={`flex items-center gap-3 w-full text-left px-2.5 py-1.5 rounded-md cursor-pointer transition-colors ${
                    active ? 'bg-primary text-primary-foreground' : 'text-foreground/90 hover:bg-secondary/50'
                  }`}
                >
                  <span
                    className={`w-7 h-7 flex items-center justify-center rounded-md border ${
                      active ? 'border-primary-foreground/30 bg-primary-foreground/10' : 'border-border/40 bg-secondary/40'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                  </span>
                  <span className="flex flex-col leading-tight">
                    <span className="text-sm font-medium">{item.title}</span>
                    <span className={`text-[11px] ${active ? 'text-primary-foreground/75' : 'text-muted-foreground/70'}`}>
                      {item.description}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

const nodeTypes: NodeTypes = { editable: EditableNode };

interface MindMapProps {
  document: Document;
  onUpdateContent: (content: string) => void;
  onRequestSave: () => void;
  theme: ThemeType;
}

function parseContent(content: string): { nodes: MindNode[]; edges: Edge[] } {
  try {
    const parsed = JSON.parse(content || '{}');
    return {
      nodes: Array.isArray(parsed.nodes) ? parsed.nodes : [],
      edges: Array.isArray(parsed.edges) ? parsed.edges : [],
    };
  } catch {
    return { nodes: [], edges: [] };
  }
}

type LayoutMode = 'tree-down' | 'tree-right' | 'free';

const LAYOUTS: { mode: LayoutMode; title: string; description: string; icon: LucideIcon }[] = [
  { mode: 'tree-down', title: 'Tidy tree ↓', description: 'Hierarchical, top to bottom', icon: Network },
  { mode: 'tree-right', title: 'Tidy tree →', description: 'Hierarchical, left to right', icon: Workflow },
  { mode: 'free', title: 'Free flow', description: 'Keep your layout — just neaten it', icon: Wind },
];

const nodeSize = (n: MindNode) => ({
  width: Math.round(n.measured?.width ?? 170),
  height: Math.round(n.measured?.height ?? 64),
});

// Collapse axis values that sit within `threshold` of each other onto their
// shared mean — gentle straightening that preserves the overall arrangement.
function clusterAlign(values: number[], threshold: number): number[] {
  const order = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const out = [...values];
  let start = 0;
  for (let k = 1; k <= order.length; k++) {
    if (k === order.length || order[k].v - order[k - 1].v > threshold) {
      const slice = order.slice(start, k);
      const mean = slice.reduce((s, o) => s + o.v, 0) / slice.length;
      slice.forEach((o) => (out[o.i] = mean));
      start = k;
    }
  }
  return out;
}

// Nudge overlapping boxes apart along their shallower overlap axis until none
// collide, leaving `gap` px of breathing room. Mutates the boxes in place.
function resolveOverlaps(boxes: { x: number; y: number; w: number; h: number }[], gap: number) {
  for (let iter = 0; iter < 80; iter++) {
    let moved = false;
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i];
        const b = boxes[j];
        const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) + gap;
        const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) + gap;
        if (ox <= 0 || oy <= 0) continue;
        moved = true;
        if (ox < oy) {
          const push = (ox / 2) * (a.x <= b.x ? 1 : -1);
          a.x -= push;
          b.x += push;
        } else {
          const push = (oy / 2) * (a.y <= b.y ? 1 : -1);
          a.y -= push;
          b.y += push;
        }
      }
    }
    if (!moved) break;
  }
}

// Re-anchor an edge to the handle sides that face the flow, so connections take
// the short path instead of looping around the box. `axis` forces vertical/
// horizontal sides (tree modes); 'auto' picks per-edge from the geometry.
function reanchorEdge(e: Edge, centers: Map<string, { cx: number; cy: number }>, axis: 'v' | 'h' | 'auto'): Edge {
  const s = centers.get(e.source);
  const t = centers.get(e.target);
  if (!s || !t) return e;
  const dx = t.cx - s.cx;
  const dy = t.cy - s.cy;
  const vertical = axis === 'v' || (axis === 'auto' && Math.abs(dy) >= Math.abs(dx));
  return {
    ...e,
    sourceHandle: vertical ? (dy >= 0 ? 'bottom' : 'top') : dx >= 0 ? 'right' : 'left',
    targetHandle: vertical ? (dy >= 0 ? 'top' : 'bottom') : dx >= 0 ? 'left' : 'right',
  };
}

function MindMapCanvas({ document: doc, onUpdateContent, onRequestSave }: MindMapProps) {
  // The whole component is keyed by document id in App, so parsing once on mount is safe.
  const initial = useMemo(() => parseContent(doc.content), [doc.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const [nodes, setNodes, onNodesChange] = useNodesState<MindNode>(initial.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(initial.edges);
  const idRef = useRef(initial.nodes.length + 1);
  const didMount = useRef(false);
  const { fitView } = useReactFlow();

  // Keep refs to the latest state so undo/snapshot can read it without being
  // re-created on every change.
  const nodesRef = useRef(nodes);
  const edgesRef = useRef(edges);
  nodesRef.current = nodes;
  edgesRef.current = edges;

  // ── Undo / redo history ────────────────────────────────────────────
  const pastRef = useRef<{ nodes: MindNode[]; edges: Edge[] }[]>([]);
  const futureRef = useRef<{ nodes: MindNode[]; edges: Edge[] }[]>([]);
  const [, setHistVer] = useState(0);

  // Snapshot the *current* state. Call right before any mutation so undo can
  // step back to it; any new action clears the redo stack.
  const takeSnapshot = useCallback(() => {
    pastRef.current = [...pastRef.current.slice(-49), { nodes: nodesRef.current, edges: edgesRef.current }];
    futureRef.current = [];
    setHistVer((v) => v + 1);
  }, []);

  const undo = useCallback(() => {
    const past = pastRef.current;
    if (!past.length) return;
    pastRef.current = past.slice(0, -1);
    futureRef.current = [...futureRef.current, { nodes: nodesRef.current, edges: edgesRef.current }];
    setNodes(past[past.length - 1].nodes);
    setEdges(past[past.length - 1].edges);
    setHistVer((v) => v + 1);
  }, [setNodes, setEdges]);

  const redo = useCallback(() => {
    const future = futureRef.current;
    if (!future.length) return;
    futureRef.current = future.slice(0, -1);
    pastRef.current = [...pastRef.current, { nodes: nodesRef.current, edges: edgesRef.current }];
    setNodes(future[future.length - 1].nodes);
    setEdges(future[future.length - 1].edges);
    setHistVer((v) => v + 1);
  }, [setNodes, setEdges]);

  const canUndo = pastRef.current.length > 0;
  const canRedo = futureRef.current.length > 0;

  // Ctrl/Cmd+Z to undo, Ctrl+Y or Ctrl/Cmd+Shift+Z to redo. Ignored while typing
  // inside a node so the textarea keeps its own native undo.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const el = document.activeElement as HTMLElement | null;
      const tag = el?.tagName.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || el?.isContentEditable) return;
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if (k === 'y' || (k === 'z' && e.shiftKey)) {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);

  // ── Layout flavour menu ────────────────────────────────────────────
  const [layoutOpen, setLayoutOpen] = useState(false);
  const layoutRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!layoutOpen) return;
    const onDown = (e: MouseEvent) => {
      if (layoutRef.current && !layoutRef.current.contains(e.target as HTMLElement)) setLayoutOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [layoutOpen]);

  const onConnect = useCallback(
    (c: Connection) => {
      takeSnapshot();
      setEdges((eds) => addEdge({ ...c, animated: true }, eds));
    },
    [setEdges, takeSnapshot],
  );

  const addNode = useCallback(
    (shape: ShapeId) => {
      takeSnapshot();
      const id = `n${idRef.current++}`;
      const newNode: MindNode = {
        id,
        type: 'editable',
        position: { x: 140 + Math.random() * 320, y: 80 + Math.random() * 280 },
        data: { label: 'New idea', color: PALETTE[idRef.current % PALETTE.length], shape },
      };
      setNodes((nds) => [...nds, newNode]);
    },
    [setNodes, takeSnapshot],
  );

  const recolorSelected = useCallback(
    (color: string) => {
      takeSnapshot();
      setNodes((nds) => nds.map((n) => (n.selected ? { ...n, data: { ...n.data, color } } : n)));
    },
    [setNodes, takeSnapshot],
  );

  // Snapshot before drags and deletions so they can be undone.
  const onNodeDragStart = useCallback(() => takeSnapshot(), [takeSnapshot]);
  const onSelectionDragStart = useCallback(() => takeSnapshot(), [takeSnapshot]);
  const onBeforeDelete = useCallback(async () => {
    takeSnapshot();
    return true;
  }, [takeSnapshot]);

  // Re-lay the map in the chosen flavour. Tree modes use dagre (hierarchical,
  // crossing-minimised via its median/barycenter ordering). "free" keeps the
  // user's arrangement and only straightens near-aligned nodes + de-overlaps.
  // Every mode re-anchors edges to the facing handle sides so curves stay short.
  const runLayout = useCallback(
    (mode: LayoutMode) => {
      if (nodes.length < 2) return;
      takeSnapshot();

      if (mode === 'free') {
        const xs = clusterAlign(nodes.map((n) => n.position.x), 34);
        const ys = clusterAlign(nodes.map((n) => n.position.y), 34);
        const boxes = nodes.map((n, i) => {
          const { width, height } = nodeSize(n);
          return { x: xs[i], y: ys[i], w: width, h: height };
        });
        resolveOverlaps(boxes, 26);
        const centers = new Map<string, { cx: number; cy: number }>();
        const nextNodes = nodes.map((n, i) => {
          centers.set(n.id, { cx: boxes[i].x + boxes[i].w / 2, cy: boxes[i].y + boxes[i].h / 2 });
          return { ...n, position: { x: boxes[i].x, y: boxes[i].y } };
        });
        setNodes(nextNodes);
        setEdges((eds) => eds.map((e) => reanchorEdge(e, centers, 'auto')));
        requestAnimationFrame(() => fitView({ padding: 0.2, duration: 400 }));
        return;
      }

      const rankdir = mode === 'tree-right' ? 'LR' : 'TB';
      const g = new dagre.graphlib.Graph();
      g.setGraph({ rankdir, nodesep: 56, ranksep: 88, marginx: 24, marginy: 24 });
      g.setDefaultEdgeLabel(() => ({}));
      nodes.forEach((n) => g.setNode(n.id, nodeSize(n)));
      edges.forEach((e) => {
        if (g.hasNode(e.source) && g.hasNode(e.target)) g.setEdge(e.source, e.target);
      });
      dagre.layout(g);

      // dagre returns node centres; React Flow positions are top-left corners.
      const centers = new Map<string, { cx: number; cy: number }>();
      const nextNodes = nodes.map((n) => {
        const p = g.node(n.id);
        if (!p) return n;
        const { width, height } = nodeSize(n);
        centers.set(n.id, { cx: p.x, cy: p.y });
        return { ...n, position: { x: p.x - width / 2, y: p.y - height / 2 } };
      });
      setNodes(nextNodes);
      setEdges((eds) => eds.map((e) => reanchorEdge(e, centers, rankdir === 'TB' ? 'v' : 'h')));
      requestAnimationFrame(() => fitView({ padding: 0.2, duration: 400 }));
    },
    [nodes, edges, setNodes, setEdges, fitView, takeSnapshot],
  );

  // Persist (debounced) on any change after the initial hydration render.
  useEffect(() => {
    if (!didMount.current) {
      didMount.current = true;
      return;
    }
    const t = setTimeout(() => onUpdateContent(JSON.stringify({ nodes, edges })), 400);
    return () => clearTimeout(t);
  }, [nodes, edges, onUpdateContent]);

  const btn =
    'flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-md border border-border/30 hover:bg-secondary/60 active:scale-95 cursor-pointer transition-all';
  const iconBtn =
    'flex items-center justify-center w-7 h-7 rounded-md border border-border/30 text-muted-foreground hover:bg-secondary/60 hover:text-foreground active:scale-95 cursor-pointer transition-all disabled:opacity-35 disabled:pointer-events-none';

  return (
    <div className="flex-1 flex flex-col bg-background overflow-hidden relative">
      <div className="h-10 bg-secondary/20 border-b border-border/30 flex items-center justify-between px-3 select-none gap-3">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-0.5">
            {SHAPES.map(({ id, label, Icon }) => (
              <button
                key={id}
                onClick={() => addNode(id)}
                title={`Add ${label.toLowerCase()} node`}
                className="flex items-center justify-center w-7 h-7 rounded-md border border-border/30 text-muted-foreground hover:bg-secondary/60 hover:text-primary hover:border-primary/50 active:scale-95 cursor-pointer transition-all"
              >
                <Icon className="w-4 h-4" />
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1 ml-1 pl-1.5 border-l border-border/30">
            {PALETTE.map((c) => (
              <button
                key={c}
                onClick={() => recolorSelected(c)}
                style={{ background: c }}
                className="w-4 h-4 rounded-full border border-white/30 hover:scale-115 active:scale-95 cursor-pointer transition-transform"
                title="Recolor selected node(s)"
              />
            ))}
          </div>

          <div className="flex items-center gap-0.5 ml-1 pl-1.5 border-l border-border/30">
            <button onClick={undo} disabled={!canUndo} className={iconBtn} title="Undo (Ctrl+Z)">
              <Undo2 className="w-4 h-4" />
            </button>
            <button onClick={redo} disabled={!canRedo} className={iconBtn} title="Redo (Ctrl+Y)">
              <Redo2 className="w-4 h-4" />
            </button>
          </div>

          <div ref={layoutRef} className="relative ml-1 pl-1.5 border-l border-border/30">
            <button
              onClick={() => setLayoutOpen((o) => !o)}
              className={`${btn} text-primary`}
              title="Auto-layout options"
              aria-expanded={layoutOpen}
            >
              <Wand2 className="w-3.5 h-3.5" /> Layout
              <ChevronDown className={`w-3 h-3 opacity-70 transition-transform ${layoutOpen ? 'rotate-180' : ''}`} />
            </button>
            {layoutOpen && (
              <div className="absolute left-1.5 top-full mt-1.5 z-50 w-64 p-1.5 rounded-xl border border-border/60 bg-popover text-popover-foreground shadow-[0_12px_40px_rgba(0,0,0,0.35)]">
                {LAYOUTS.map(({ mode, title, description, icon: Icon }) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => {
                      runLayout(mode);
                      setLayoutOpen(false);
                    }}
                    className="flex items-center gap-3 w-full text-left px-2.5 py-1.5 rounded-md cursor-pointer transition-colors text-foreground/90 hover:bg-secondary/60"
                  >
                    <span className="w-7 h-7 flex items-center justify-center rounded-md border border-border/40 bg-secondary/40 shrink-0">
                      <Icon className="w-4 h-4" />
                    </span>
                    <span className="flex flex-col leading-tight">
                      <span className="text-sm font-medium">{title}</span>
                      <span className="text-[11px] text-muted-foreground/70">{description}</span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        <span className="text-[11px] text-muted-foreground/80 hidden md:block truncate">
          Click a shape to add it · Double-click to edit · drag any side to connect · Del to remove
        </span>
        <button onClick={onRequestSave} className={`${btn} text-primary`} title="Save mind map">
          <Save className="w-3.5 h-3.5" /> Save
        </button>
      </div>

      <div className="flex-1 min-h-0">
        <ReactFlow<MindNode, Edge>
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeDragStart={onNodeDragStart}
          onSelectionDragStart={onSelectionDragStart}
          onBeforeDelete={onBeforeDelete}
          nodeTypes={nodeTypes}
          connectionMode={ConnectionMode.Loose}
          fitView
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={18} size={1} color="var(--border)" />
          <Controls />
          <MiniMap pannable zoomable className="!bg-secondary/40" />
        </ReactFlow>
      </div>
    </div>
  );
}

export default function MindMap(props: MindMapProps) {
  return (
    <ReactFlowProvider>
      <MindMapCanvas {...props} />
    </ReactFlowProvider>
  );
}
