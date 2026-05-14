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
  Input,
  formatNumber,
} from "@policyengine/ui-kit";
import { AppShell } from "@/components/layout/app-shell";
import {
  usePipeline,
  useStageDoc,
  type PipelineNode,
  type PipelinePathway,
} from "@/lib/api/hooks/use-pipeline";

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
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-col items-start gap-1 rounded-lg border p-4 text-left transition-colors ${
        active
          ? "border-primary bg-primary/5"
          : "border-border bg-white hover:bg-muted/40"
      }`}
    >
      <span className="text-xs uppercase tracking-wide text-muted-foreground">
        {pathway.id}
      </span>
      <span className="text-2xl font-bold">{pathway.node_count}</span>
      <span className="text-xs text-muted-foreground">
        nodes · {pathway.has_doc ? "deep-dive ready" : "no doc yet"}
      </span>
    </button>
  );
}

function NodeRow({ node }: { node: PipelineNode }) {
  return (
    <tr className="border-b border-border/40 hover:bg-muted/30">
      <td className="py-2 pr-3 font-mono text-xs">{node.id}</td>
      <td className="py-2 pr-3 text-sm">{node.label}</td>
      <td className="py-2 pr-3">
        <Badge variant={STATUS_VARIANT[node.status ?? "unknown"] ?? "secondary"}>
          {node.status ?? "?"}
        </Badge>
      </td>
      <td className="py-2 pr-3 text-xs text-muted-foreground">{node.node_type}</td>
      <td className="py-2 pr-3 text-xs text-muted-foreground">
        {(node.pathways ?? []).join(", ")}
      </td>
      <td className="py-2 pr-3 font-mono text-xs text-muted-foreground">
        {node.source_file?.replace("policyengine_us_data/", "")}
        {node.decorator_line ? `:${node.decorator_line}` : ""}
      </td>
    </tr>
  );
}

function StageDoc({ stageId }: { stageId: string }) {
  const q = useStageDoc(stageId);
  if (q.isLoading)
    return <Skeleton className="h-48 w-full" />;
  if (q.error)
    return (
      <Text c="dimmed">
        Deep-dive for <code>{stageId}</code> not available yet
        (agent may still be writing it).
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
  const [search, setSearch] = useState("");

  const filteredNodes = useMemo(() => {
    if (!pipeline.data) return [];
    const s = search.trim().toLowerCase();
    return pipeline.data.nodes.filter((n) => {
      if (activePathway && !(n.pathways ?? []).includes(activePathway)) {
        return false;
      }
      if (!s) return true;
      return (
        n.id.toLowerCase().includes(s) ||
        (n.label ?? "").toLowerCase().includes(s) ||
        (n.description ?? "").toLowerCase().includes(s)
      );
    });
  }, [pipeline.data, activePathway, search]);

  return (
    <AppShell>
      <Stack gap="lg">
        <div>
          <Title order={2}>Data pipeline</Title>
          <Text c="dimmed" size="sm">
            Every <code>@pipeline_node</code> declared in{" "}
            <code>policyengine_us_data</code>. Grouped by pathway. Click a
            pathway card to load its deep-dive.
          </Text>
        </div>

        {pipeline.isLoading && <Skeleton className="h-32 w-full" />}
        {pipeline.error && (
          <Card>
            <CardContent className="py-6">
              <Text c="red">
                Failed to load pipeline: {String(pipeline.error)}
              </Text>
              <Text size="xs" c="dimmed" className="mt-2">
                If this is a fresh setup, run{" "}
                <code>python backend/scripts/extract_pipeline_dag.py</code>{" "}
                to generate the DAG.
              </Text>
            </CardContent>
          </Card>
        )}

        {pipeline.data && (
          <>
            <Card>
              <CardHeader>
                <CardTitle>
                  Pathways · {pipeline.data.stats.node_count} nodes total
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {pipeline.data.pathways.map((p) => (
                    <PathwayCard
                      key={p.id}
                      pathway={p}
                      active={activePathway === p.id}
                      onClick={() =>
                        setActivePathway(activePathway === p.id ? null : p.id)
                      }
                    />
                  ))}
                </div>
              </CardContent>
            </Card>

            {activePathway && (
              <Card>
                <CardHeader>
                  <CardTitle>
                    Deep dive: {activePathway}
                    <button
                      type="button"
                      onClick={() => setActivePathway(null)}
                      className="ml-3 text-sm text-muted-foreground hover:text-foreground"
                    >
                      ✕
                    </button>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <StageDoc stageId={activePathway} />
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader>
                <CardTitle>
                  Nodes
                  {activePathway && (
                    <span className="ml-2 text-sm font-normal text-muted-foreground">
                      filtered to <code>{activePathway}</code>
                    </span>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="mb-3 max-w-md">
                  <Input
                    placeholder="Search nodes by id, label, or description…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
                <div className="text-xs text-muted-foreground mb-2">
                  Showing {formatNumber(filteredNodes.length)} of{" "}
                  {formatNumber(pipeline.data.nodes.length)} nodes
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-xs uppercase text-muted-foreground">
                        <th className="py-2 pr-3">ID</th>
                        <th className="py-2 pr-3">Label</th>
                        <th className="py-2 pr-3">Status</th>
                        <th className="py-2 pr-3">Type</th>
                        <th className="py-2 pr-3">Pathways</th>
                        <th className="py-2 pr-3">Source</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredNodes.map((n) => (
                        <NodeRow key={n.id} node={n} />
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </Stack>
    </AppShell>
  );
}
