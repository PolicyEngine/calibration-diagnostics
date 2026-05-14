"use client";

import { useState, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Skeleton,
  Stack,
  Title,
  Text,
  Badge,
  formatNumber,
} from "@policyengine/ui-kit";
import { AppShell } from "@/components/layout/app-shell";
import {
  usePipeline,
  useStageDoc,
  type PipelineNode,
  type PipelinePathway,
} from "@/lib/api/hooks/use-pipeline";
import { PipelineGraph } from "@/components/pipeline/pipeline-graph";

const PATHWAY_COLORS: Record<string, string> = {
  data_build: "border-amber-500 bg-amber-50",
  calibration_package: "border-blue-500 bg-blue-50",
  weight_fit: "border-green-500 bg-green-50",
  local_h5: "border-pink-500 bg-pink-50",
};

const STATUS_VARIANT: Record<string, "success" | "secondary" | "warning" | "error"> = {
  current: "success",
  transitional: "warning",
  legacy: "secondary",
  planned: "secondary",
  unknown: "secondary",
};

function PathwayCard({
  pathway,
  active,
  onClick,
}: {
  pathway: PipelinePathway;
  active: boolean;
  onClick: () => void;
}) {
  const colorClass = PATHWAY_COLORS[pathway.id] ?? "border-border bg-white";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-col items-start gap-1 rounded-lg border-2 p-4 text-left transition-all ${
        active ? "ring-2 ring-primary" : ""
      } ${colorClass}`}
    >
      <span className="text-xs uppercase tracking-wide text-muted-foreground">
        {pathway.id}
      </span>
      <span className="text-2xl font-bold">{pathway.node_count}</span>
      <span className="text-xs text-muted-foreground">
        nodes · {pathway.has_doc ? "deep-dive ready" : "no doc"}
      </span>
    </button>
  );
}

function NodeDetail({ node }: { node: PipelineNode }) {
  return (
    <div className="space-y-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm font-semibold">{node.id}</span>
        <Badge variant={STATUS_VARIANT[node.status ?? "unknown"] ?? "secondary"}>
          {node.status ?? "?"}
        </Badge>
        <Badge variant="secondary">{node.node_type}</Badge>
        {(node.pathways ?? []).map((p) => (
          <Badge key={p} variant="outline" className="text-xs">
            {p}
          </Badge>
        ))}
      </div>
      {node.label && <div className="text-sm font-medium">{node.label}</div>}
      {node.description && (
        <p className="text-sm text-muted-foreground">{node.description}</p>
      )}
      <div className="text-xs text-muted-foreground">
        <span className="font-mono">
          {node.source_file?.replace("policyengine_us_data/", "")}
          {node.decorator_line ? `:${node.decorator_line}` : ""}
        </span>
      </div>
      {node.artifacts_in && node.artifacts_in.length > 0 && (
        <div className="text-xs">
          <span className="font-semibold">in:</span>{" "}
          <span className="font-mono text-muted-foreground">
            {node.artifacts_in.join(", ")}
          </span>
        </div>
      )}
      {node.artifacts_out && node.artifacts_out.length > 0 && (
        <div className="text-xs">
          <span className="font-semibold">out:</span>{" "}
          <span className="font-mono text-muted-foreground">
            {node.artifacts_out.join(", ")}
          </span>
        </div>
      )}
    </div>
  );
}

function StageDoc({ stageId }: { stageId: string }) {
  const q = useStageDoc(stageId);
  if (q.isLoading) return <Skeleton className="h-48 w-full" />;
  if (q.error)
    return (
      <Text c="dimmed">
        Deep-dive for <code>{stageId}</code> not available yet.
      </Text>
    );
  if (!q.data) return null;
  return (
    <div className="prose prose-sm max-w-none prose-headings:font-semibold prose-h1:text-xl prose-h2:text-base prose-h2:mt-6 prose-h2:mb-2 prose-code:font-mono prose-code:text-xs prose-table:text-xs">
      <ReactMarkdown>{q.data.markdown}</ReactMarkdown>
    </div>
  );
}

export default function PipelinePage() {
  const pipeline = usePipeline();
  const [activePathway, setActivePathway] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  const selectedNode = useMemo(() => {
    if (!pipeline.data || !selectedNodeId) return null;
    return pipeline.data.nodes.find((n) => n.id === selectedNodeId) ?? null;
  }, [pipeline.data, selectedNodeId]);

  return (
    <AppShell>
      <Stack gap="lg">
        <div>
          <Title order={2}>Data pipeline</Title>
          <Text c="dimmed" size="sm">
            Every <code>@pipeline_node</code> declared in{" "}
            <code>policyengine_us_data</code>, laid out as a DAG. Click a
            pathway to filter; click a node for its details.
          </Text>
        </div>

        {pipeline.isLoading && <Skeleton className="h-64 w-full" />}
        {pipeline.error && (
          <Card>
            <CardContent className="py-6">
              <Text c="red">
                Failed to load pipeline: {String(pipeline.error)}
              </Text>
              <Text size="xs" c="dimmed" className="mt-2">
                Run{" "}
                <code>python backend/scripts/extract_pipeline_dag.py</code>{" "}
                if this is a fresh setup.
              </Text>
            </CardContent>
          </Card>
        )}

        {pipeline.data && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {pipeline.data.pathways.map((p) => (
                <PathwayCard
                  key={p.id}
                  pathway={p}
                  active={activePathway === p.id}
                  onClick={() => {
                    setActivePathway(activePathway === p.id ? null : p.id);
                    setSelectedNodeId(null);
                  }}
                />
              ))}
            </div>

            <Card>
              <CardHeader>
                <CardTitle>
                  Graph
                  {activePathway && (
                    <span className="ml-2 text-sm font-normal text-muted-foreground">
                      filtered to <code>{activePathway}</code>
                    </span>
                  )}
                  <span className="ml-2 text-sm font-normal text-muted-foreground">
                    · {formatNumber(pipeline.data.stats.node_count)} nodes,{" "}
                    {formatNumber(pipeline.data.stats.edge_count)} edges
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <PipelineGraph
                  nodes={pipeline.data.nodes}
                  edges={pipeline.data.edges}
                  activePathway={activePathway}
                  onNodeSelect={setSelectedNodeId}
                  selectedId={selectedNodeId}
                />
                <Text size="xs" c="dimmed" className="mt-2">
                  Edges shown where one node&apos;s{" "}
                  <code>artifacts_out</code> matches another&apos;s{" "}
                  <code>artifacts_in</code> (
                  {pipeline.data.edges.length} declared connections).
                  Isolated nodes are real — most pipeline_node entries don&apos;t
                  declare formal artifact flow, only their internal description.
                </Text>
              </CardContent>
            </Card>

            {selectedNode && (
              <Card>
                <CardHeader>
                  <CardTitle>
                    Node detail
                    <button
                      type="button"
                      onClick={() => setSelectedNodeId(null)}
                      className="ml-3 text-sm text-muted-foreground hover:text-foreground"
                    >
                      ✕
                    </button>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <NodeDetail node={selectedNode} />
                </CardContent>
              </Card>
            )}

            {activePathway && (
              <Card>
                <CardHeader>
                  <CardTitle>Deep dive: {activePathway}</CardTitle>
                </CardHeader>
                <CardContent>
                  <StageDoc stageId={activePathway} />
                </CardContent>
              </Card>
            )}
          </>
        )}
      </Stack>
    </AppShell>
  );
}
