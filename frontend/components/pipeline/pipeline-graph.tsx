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
  unproducedArtifacts: string[];
  activeStage: string | null;
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

function ArtifactCard({ data }: NodeProps<{ label: string; kind: "input" | "output" }>) {
  const isInput = data.kind === "input";
  return (
    <div
      className="rounded-full border-2 border-dashed px-3 py-1 text-[10px] font-mono shadow-sm"
      style={{
        backgroundColor: isInput ? "#eff6ff" : "#f0fdf4",
        borderColor: isInput ? "#3b82f6" : "#22c55e",
        color: isInput ? "#1d4ed8" : "#15803d",
        maxWidth: 200,
      }}
      title={data.label}
    >
      <Handle
        type="target"
        position={Position.Left}
        style={{ background: "transparent", border: "none", width: 1, height: 1 }}
      />
      <span className="truncate block">
        {isInput ? "⇢ " : ""}
        {data.label}
        {!isInput ? " ⇢" : ""}
      </span>
      <Handle
        type="source"
        position={Position.Right}
        style={{ background: "transparent", border: "none", width: 1, height: 1 }}
      />
    </div>
  );
}

const NODE_TYPES = { pipelineNode: NodeCard, artifactNode: ArtifactCard };

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
  unproducedArtifacts,
  activeStage,
  onNodeSelect,
  selectedId,
  showIsolated,
}: Props) {
  const { laidOutNodes, laidOutEdges } = useMemo(() => {
    // 1. Pathway filter
    const byPathway = activeStage
      ? nodes.filter((n) => (n as { stage_id?: string }).stage_id === activeStage)
      : nodes;
    const idSet = new Set(byPathway.map((n) => n.id));

    // 2. Pipeline-node edges scoped to the visible nodes
    const visibleEdges = edges.filter(
      (e) => idSet.has(e.from) && idSet.has(e.to),
    );

    // 3. Compute which artifacts are produced-but-not-consumed by THIS scope
    //    (the pipeline's terminal outputs). Also collect input artifacts that
    //    SOMETHING in this scope consumes.
    const producedHere = new Set<string>();
    const consumedHere = new Set<string>();
    for (const n of byPathway) {
      (n.artifacts_out ?? []).forEach((a) => producedHere.add(a));
      (n.artifacts_in ?? []).forEach((a) => consumedHere.add(a));
    }
    const terminalOuts = [...producedHere].filter((a) => !consumedHere.has(a));
    const externalIns = unproducedArtifacts.filter((a) => consumedHere.has(a));

    // 4. Identify nodes that touch an artifact-side node (treated as "connected"
    //    for the isolated-filter purpose).
    const nodeToTerminalOut = new Map<string, string[]>();
    for (const n of byPathway) {
      const outs = (n.artifacts_out ?? []).filter((a) => terminalOuts.includes(a));
      if (outs.length) nodeToTerminalOut.set(n.id, outs);
    }
    const externalInToNode = new Map<string, string[]>();
    for (const a of externalIns) {
      const consumers = byPathway
        .filter((n) => (n.artifacts_in ?? []).includes(a))
        .map((n) => n.id);
      if (consumers.length) externalInToNode.set(a, consumers);
    }

    // 5. Apply the isolated filter
    let filtered = byPathway;
    if (!showIsolated) {
      const connected = new Set<string>();
      visibleEdges.forEach((e) => {
        connected.add(e.from);
        connected.add(e.to);
      });
      nodeToTerminalOut.forEach((_, id) => connected.add(id));
      externalInToNode.forEach((consumers) => consumers.forEach((c) => connected.add(c)));
      filtered = byPathway.filter((n) => connected.has(n.id));
    }
    const visibleIdSet = new Set(filtered.map((n) => n.id));

    // 6. Build React Flow nodes & edges
    const rfNodes: Node[] = filtered.map((n) => ({
      id: n.id,
      type: "pipelineNode",
      position: { x: 0, y: 0 },
      data: { node: n, selected: n.id === selectedId },
    }));

    // Input artifact nodes (on the left)
    externalIns.forEach((a) => {
      const consumers = externalInToNode.get(a) ?? [];
      if (!consumers.some((c) => visibleIdSet.has(c))) return;
      rfNodes.push({
        id: `__in__${a}`,
        type: "artifactNode",
        position: { x: 0, y: 0 },
        data: { label: a, kind: "input" },
      });
    });
    // Output artifact nodes (on the right)
    terminalOuts.forEach((a) => {
      const producers = filtered.filter((n) =>
        (n.artifacts_out ?? []).includes(a),
      );
      if (!producers.length) return;
      rfNodes.push({
        id: `__out__${a}`,
        type: "artifactNode",
        position: { x: 0, y: 0 },
        data: { label: a, kind: "output" },
      });
    });

    const rfEdges: Edge[] = [];
    visibleEdges
      .filter((e) => visibleIdSet.has(e.from) && visibleIdSet.has(e.to))
      .forEach((e, i) => {
        rfEdges.push({
          id: `e${i}`,
          source: e.from,
          target: e.to,
          label: e.artifact,
          labelStyle: { fontSize: 9, fill: "#6b7280" },
          labelBgStyle: { fill: "#fff", opacity: 0.85 },
          style: { stroke: "#94a3b8", strokeWidth: 1.5 },
          type: "smoothstep",
        });
      });
    // Artifact ↔ node edges
    externalInToNode.forEach((consumers, a) => {
      consumers
        .filter((c) => visibleIdSet.has(c))
        .forEach((c, i) => {
          rfEdges.push({
            id: `ein-${a}-${i}`,
            source: `__in__${a}`,
            target: c,
            style: { stroke: "#93c5fd", strokeWidth: 1, strokeDasharray: "4 4" },
            type: "smoothstep",
          });
        });
    });
    nodeToTerminalOut.forEach((outs, nodeId) => {
      if (!visibleIdSet.has(nodeId)) return;
      outs.forEach((a, i) => {
        rfEdges.push({
          id: `eout-${nodeId}-${i}`,
          source: nodeId,
          target: `__out__${a}`,
          style: { stroke: "#86efac", strokeWidth: 1, strokeDasharray: "4 4" },
          type: "smoothstep",
        });
      });
    });

    const laid = layoutWithDagre(rfNodes, rfEdges);
    return { laidOutNodes: laid.nodes, laidOutEdges: laid.edges };
  }, [nodes, edges, unproducedArtifacts, activeStage, selectedId, showIsolated]);

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
