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

export function usePipeline() {
  return useQuery({
    queryKey: ["pipeline"],
    queryFn: async () => {
      const r = await apiGet<PipelineResponse>("/pipeline");
      // Backwards-compat: if the backend predates stages, derive from pathways.
      if (!r.stages) r.stages = r.pathways.map((p) => ({ ...p }));
      return r;
    },
    staleTime: 60 * 60 * 1000,
  });
}

interface StageDoc {
  stage_id: string;
  markdown: string;
}

export function useStageDoc(stageId: string | null) {
  return useQuery({
    queryKey: ["pipeline", "stage", stageId],
    queryFn: () => apiGet<StageDoc>(`/pipeline/stages/${stageId}`),
    enabled: !!stageId,
    staleTime: 60 * 60 * 1000,
  });
}
