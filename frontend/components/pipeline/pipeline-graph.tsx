"use client";

import { useMemo, useCallback } from "react";
import ReactFlow, {
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  type Node,
  type Edge,
  type NodeProps,
} from "reactflow";
import "reactflow/dist/style.css";
import dagre from "dagre";
import type {
  PipelineNode,
  PipelineEdge,
} from "@/lib/api/hooks/use-pipeline";

// Single neutral palette; "transitional" / "legacy" nodes get a dimmer
// treatment via opacity. No per-pathway colour by default — keeps the
// graph readable when many statuses overlap.
const NODE_STYLE = {
  current:      { bg: "#ffffff", border: "#475569", text: "#0f172a" },
  transitional: { bg: "#fef9c3", border: "#a16207", text: "#3f2c00" },
  legacy:       { bg: "#f1f5f9", border: "#94a3b8", text: "#64748b" },
};

interface Props {
  nodes: PipelineNode[];
  edges: PipelineEdge[];
  activePathway: string | null;
  onNodeSelect: (id: string | null) => void;
  selectedId: string | null;
  /** When true, show every node. Otherwise hide isolated nodes (no edges). */
  showIsolated: boolean;
}

// --- custom node card ----------------------------------------------------

function NodeCard({ data }: NodeProps<{ node: PipelineNode; selected: boolean }>) {
  const n = data.node;
  const style = NODE_STYLE[(n.status ?? "current") as keyof typeof NODE_STYLE]
    ?? NODE_STYLE.current;

  return (
    <div
      className={`rounded-md border px-3 py-1.5 shadow-sm transition-all min-w-[140px] max-w-[220px] ${
        data.selected ? "ring-2 ring-primary ring-offset-1" : ""
      }`}
      style={{
        backgroundColor: style.bg,
        borderColor: style.border,
        color: style.text,
      }}
    >
      <Handle
        type="target"
        position={Position.Left}
        style={{ background: style.border, width: 6, height: 6 }}
      />
      <div className="font-mono text-[11px] font-semibold truncate" title={n.id}>
        {n.id}
      </div>
      {n.label && n.label !== n.id && (
        <div className="text-[10px] opacity-70 truncate" title={n.label}>
          {n.label}
        </div>
      )}
      <Handle
        type="source"
        position={Position.Right}
        style={{ background: style.border, width: 6, height: 6 }}
      />
    </div>
  );
}

const NODE_TYPES = { pipelineNode: NodeCard };

// --- layout --------------------------------------------------------------

function layoutWithDagre(
  rawNodes: Node[],
  rawEdges: Edge[],
  direction: "LR" | "TB" = "LR",
): { nodes: Node[]; edges: Edge[] } {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: direction, nodesep: 22, ranksep: 60, marginx: 20, marginy: 20 });

  const nodeWidth = 200;
  const nodeHeight = 50;
  rawNodes.forEach((n) =>
    g.setNode(n.id, { width: nodeWidth, height: nodeHeight }),
  );
  rawEdges.forEach((e) => g.setEdge(e.source, e.target));

  dagre.layout(g);

  const nodes = rawNodes.map((n) => {
    const pos = g.node(n.id);
    return {
      ...n,
      position: { x: pos.x - nodeWidth / 2, y: pos.y - nodeHeight / 2 },
      sourcePosition: direction === "LR" ? Position.Right : Position.Bottom,
      targetPosition: direction === "LR" ? Position.Left : Position.Top,
    };
  });
  return { nodes, edges: rawEdges };
}

// --- main component ------------------------------------------------------

export function PipelineGraph({
  nodes,
  edges,
  activePathway,
  onNodeSelect,
  selectedId,
  showIsolated,
}: Props) {
  const { laidOutNodes, laidOutEdges } = useMemo(() => {
    // 1. Pathway filter
    const byPathway = activePathway
      ? nodes.filter((n) => (n.pathways ?? []).includes(activePathway))
      : nodes;
    const idSet = new Set(byPathway.map((n) => n.id));

    // 2. Edges scoped to the visible nodes
    const visibleEdges = edges.filter(
      (e) => idSet.has(e.from) && idSet.has(e.to),
    );

    // 3. Optionally hide isolated nodes (the default — keeps the canvas focused)
    let filtered = byPathway;
    if (!showIsolated) {
      const connectedIds = new Set<string>();
      visibleEdges.forEach((e) => {
        connectedIds.add(e.from);
        connectedIds.add(e.to);
      });
      filtered = byPathway.filter((n) => connectedIds.has(n.id));
    }
    const visibleIdSet = new Set(filtered.map((n) => n.id));

    const rfNodes: Node[] = filtered.map((n) => ({
      id: n.id,
      type: "pipelineNode",
      position: { x: 0, y: 0 },
      data: { node: n, selected: n.id === selectedId },
    }));

    const rfEdges: Edge[] = visibleEdges
      .filter((e) => visibleIdSet.has(e.from) && visibleIdSet.has(e.to))
      .map((e, i) => ({
        id: `e${i}`,
        source: e.from,
        target: e.to,
        label: e.artifact,
        labelStyle: { fontSize: 9, fill: "#6b7280" },
        labelBgStyle: { fill: "#fff", opacity: 0.85 },
        style: { stroke: "#94a3b8", strokeWidth: 1.5 },
        type: "smoothstep",
      }));

    const laid = layoutWithDagre(rfNodes, rfEdges);
    return { laidOutNodes: laid.nodes, laidOutEdges: laid.edges };
  }, [nodes, edges, activePathway, selectedId, showIsolated]);

  const handleNodeClick = useCallback(
    (_evt: React.MouseEvent, node: Node) => {
      onNodeSelect(node.id === selectedId ? null : node.id);
    },
    [selectedId, onNodeSelect],
  );

  return (
    <div style={{ width: "100%", height: 600 }} className="rounded-md border border-border bg-muted/20">
      <ReactFlow
        nodes={laidOutNodes}
        edges={laidOutEdges}
        nodeTypes={NODE_TYPES}
        onNodeClick={handleNodeClick}
        onPaneClick={() => onNodeSelect(null)}
        fitView
        proOptions={{ hideAttribution: true }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
      >
        <Background gap={20} size={1} />
        <Controls showInteractive={false} />
        <MiniMap pannable zoomable nodeColor="#475569" />
      </ReactFlow>
    </div>
  );
}
