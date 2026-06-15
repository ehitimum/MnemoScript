import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { Plus, Save } from 'lucide-react';

type MindNodeData = { label: string; color: string };
type MindNode = Node<MindNodeData>;

const PALETTE = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#a855f7'];

function EditableNode({ id, data, selected }: NodeProps<MindNode>) {
  const { setNodes } = useReactFlow<MindNode>();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(data.label);

  const startEdit = () => {
    setDraft(data.label);
    setEditing(true);
  };

  const commit = () => {
    setEditing(false);
    setNodes((nds) => nds.map((n) => (n.id === id ? { ...n, data: { ...n.data, label: draft } } : n)));
  };

  return (
    <div
      className="mindmap-node"
      style={{
        background: data.color,
        boxShadow: selected
          ? `0 0 0 2px var(--background), 0 0 0 4px ${data.color}`
          : '0 6px 18px rgba(0,0,0,0.28)',
      }}
      onDoubleClick={startEdit}
    >
      <Handle type="target" position={Position.Top} className="mindmap-handle" />
      {editing ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') setEditing(false);
          }}
          className="mindmap-node-input"
        />
      ) : (
        <span className="mindmap-node-label">{data.label || 'Untitled'}</span>
      )}
      <Handle type="source" position={Position.Bottom} className="mindmap-handle" />
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

function MindMapCanvas({ document: doc, onUpdateContent, onRequestSave }: MindMapProps) {
  // The whole component is keyed by document id in App, so parsing once on mount is safe.
  const initial = useMemo(() => parseContent(doc.content), [doc.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const [nodes, setNodes, onNodesChange] = useNodesState<MindNode>(initial.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(initial.edges);
  const idRef = useRef(initial.nodes.length + 1);
  const didMount = useRef(false);

  const onConnect = useCallback(
    (c: Connection) => setEdges((eds) => addEdge({ ...c, animated: true }, eds)),
    [setEdges],
  );

  const addNode = useCallback(() => {
    const id = `n${idRef.current++}`;
    const newNode: MindNode = {
      id,
      type: 'editable',
      position: { x: 140 + Math.random() * 320, y: 80 + Math.random() * 280 },
      data: { label: 'New idea', color: PALETTE[idRef.current % PALETTE.length] },
    };
    setNodes((nds) => [...nds, newNode]);
  }, [setNodes]);

  const recolorSelected = useCallback(
    (color: string) => {
      setNodes((nds) => nds.map((n) => (n.selected ? { ...n, data: { ...n.data, color } } : n)));
    },
    [setNodes],
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

  return (
    <div className="flex-1 flex flex-col bg-background overflow-hidden relative">
      <div className="h-10 bg-secondary/20 border-b border-border/30 flex items-center justify-between px-3 select-none gap-3">
        <div className="flex items-center gap-2">
          <button onClick={addNode} className={`${btn} text-primary`} title="Add a node">
            <Plus className="w-3.5 h-3.5" /> Add Node
          </button>
          <div className="flex items-center gap-1 ml-1">
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
        </div>
        <span className="text-[11px] text-muted-foreground/80 hidden md:block truncate">
          Double-click to rename · drag handles to connect · Del to remove
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
          nodeTypes={nodeTypes}
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
