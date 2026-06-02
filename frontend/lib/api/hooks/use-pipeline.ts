import { useQuery } from "@tanstack/react-query";
import { apiGet } from "../client";

export interface PipelineNode {
  id: string;
  label: string;
  description?: string;
  node_type?: string;
  status?: string;
  stability?: string;
  source_file?: string;
  decorator_line?: number;
  target_symbol?: string;
  artifacts_in?: string[];
  artifacts_out?: string[];
  pathways?: string[];
  stage_id?: string;
  validation_commands?: string[];
  implementation_refs?: string[];
  explanation?: string;
  analyst_questions?: string[];
}

export interface PipelineEdge {
  from: string;
  to: string;
  artifact: string;
  kind: string;
}

export interface PipelinePathway {
  id: string;
  label: string;
  node_count: number;
  has_doc: boolean;
}

export interface PipelineStage {
  id: string;
  label: string;
  node_count: number;
  has_doc: boolean;
}

export interface PipelineResponse {
  pipeline_id?: string;
  pipeline_label?: string;
  description?: string;
  source_repo?: string | null;
  source_urls?: string[];
  nodes: PipelineNode[];
  edges: PipelineEdge[];
  unproduced_artifacts: string[];
  stats: {
    node_count: number;
    edge_count: number;
    by_type: Record<string, number>;
    by_status: Record<string, number>;
    by_pathway: Record<string, number>;
    by_stage?: Record<string, number>;
  };
  stages: PipelineStage[];
  pathways: PipelinePathway[];
}

export interface PipelineOption {
  id: string;
  label: string;
  description: string;
}

export const PIPELINE_OPTIONS: PipelineOption[] = [
  {
    id: "us-data",
    label: "policyengine-us-data",
    description: "Extracted DAG from policyengine_us_data decorators.",
  },
  {
    id: "microplex-us",
    label: "Microplex-US",
    description: "Curated source-fusion through PE oracle pipeline.",
  },
];

export function usePipeline(pipelineId = "us-data") {
  return useQuery({
    queryKey: ["pipeline", pipelineId],
    queryFn: async () => {
      const r = await apiGet<PipelineResponse>("/pipeline", {
        pipeline_id: pipelineId,
      });
      // Backwards-compat: if the backend predates stages, derive from pathways.
      if (!r.stages) r.stages = r.pathways.map((p) => ({ ...p }));
      return r;
    },
    staleTime: 60 * 60 * 1000,
  });
}

interface StageDoc {
  pipeline_id?: string;
  stage_id: string;
  markdown: string;
}

export function useStageDoc(stageId: string | null, pipelineId = "us-data") {
  return useQuery({
    queryKey: ["pipeline", "stage", pipelineId, stageId],
    queryFn: () =>
      apiGet<StageDoc>(`/pipeline/stages/${stageId}`, {
        pipeline_id: pipelineId,
      }),
    enabled: !!stageId,
    staleTime: 60 * 60 * 1000,
  });
}
