import { useQuery } from "@tanstack/react-query";
import { apiGet } from "../client";
import { useRunQueryState } from "./use-runs";

export interface CaseStudy {
  id: string;
  label: string;
  description: string;
  primary_variables: string[];
  dependency_variables: string[];
  state_fips: number | null;
}

export interface CaseStudyList {
  items: CaseStudy[];
}

export interface TargetCoverageRow {
  variable: string;
  geo_level: string;
  domain_variable: string;
  target_count: number;
  included_count: number;
  evaluated_count: number;
  median_abs_rel_error: number | null;
  max_abs_rel_error: number | null;
}

export interface ReadinessResponse {
  case_study: CaseStudy;
  status: "ready" | "caution" | "blocked";
  blockers: string[];
  warnings: string[];
  target_summary: {
    relevant_targets: number;
    included_targets: number;
    count: number;
    evaluated: number;
    median_abs_rel_error: number | null;
    max_abs_rel_error: number | null;
    pct_under_10pct: number | null;
    pct_under_25pct: number | null;
  };
  target_coverage: TargetCoverageRow[];
  modeled_variables: {
    present_dependency_variables: string[];
    missing_dependency_variables: string[];
    state_specific_matches: string[];
  };
  weight_quality: {
    households: number;
    kish_effective_n: number | null;
    top_1pct_weight_share: number | null;
    top_5pct_weight_share: number | null;
  };
  recommendations: string[];
}

export interface TargetConfigRuleAudit {
  section: "include" | "exclude";
  index: number;
  rule: Record<string, string>;
  matched_targets: number;
  status: "matched" | "zero_match";
}

export interface TargetConfigAudit {
  has_target_config: boolean;
  rule_count: number;
  zero_match_count: number;
  matched_rule_count: number;
  selected_variable: string | null;
  target_count: number;
  included_target_count: number;
  rules: TargetConfigRuleAudit[];
}

export interface DomainBreakdownRow {
  bucket: string;
  lower: number | null;
  upper: number | null;
  target_count: number;
  included_target_count: number;
  evaluated_target_count: number;
  median_abs_rel_error: number | null;
  max_abs_rel_error: number | null;
  variables: string[];
  geo_levels: string[];
}

export interface DomainBreakdown {
  variable: string | null;
  domain_variable: string;
  geo_level: string | null;
  rows: DomainBreakdownRow[];
  summary: {
    target_count: number;
    included_target_count: number;
    evaluated_target_count: number;
    median_abs_rel_error?: number | null;
    max_abs_rel_error?: number | null;
  };
}

export interface DependencyNode {
  id: string;
  variable: string;
  period: string | null;
  depth: number;
  dependency_count: number;
  is_leaf: boolean;
  label: string;
  entity: string | null;
  is_policyengine_variable: boolean;
  is_formula: boolean;
  is_aggregate: boolean;
  is_stored_input: boolean;
  is_target_variable: boolean;
  is_domain_variable: boolean;
  target_count: number;
  direct_target_count: number;
  domain_target_count: number;
  included_target_count: number;
  evaluated_target_count: number;
  median_abs_rel_error: number | null;
  max_abs_rel_error: number | null;
}

export interface DependencyTrace {
  variable: string;
  root: string;
  summary: {
    total_trace_nodes: number;
    returned_nodes: number;
    truncated: boolean;
    leaf_nodes: number;
    stored_leaf_nodes: number;
    targeted_leaf_nodes: number;
    untargeted_stored_leaf_nodes: number;
  };
  nodes: DependencyNode[];
  edges: { from: string; to: string }[];
}

export interface PolicyEngineVariable {
  name: string;
  label: string;
  entity: string | null;
  definition_period: string;
  is_formula: boolean;
  is_aggregate: boolean;
  is_target_variable: boolean;
  is_domain_variable: boolean;
  target_count: number;
  included_target_count: number;
  domain_count: number;
}

export interface PolicyEngineVariableList {
  items: PolicyEngineVariable[];
}

export function useCaseStudies() {
  return useQuery({
    queryKey: ["analysis", "case-studies"],
    queryFn: () => apiGet<CaseStudyList>("/analysis/case-studies"),
    staleTime: 60 * 60 * 1000,
  });
}

export function usePolicyEngineVariables(search: string) {
  const { dataset, run, ready } = useRunQueryState();
  return useQuery({
    queryKey: ["analysis", "variables", dataset, run, search],
    queryFn: () =>
      apiGet<PolicyEngineVariableList>("/analysis/variables", {
        search: search.trim() || undefined,
        limit: 120,
      }),
    enabled: ready,
    staleTime: 60 * 60 * 1000,
  });
}

export function useReadiness(caseStudyId: string | null) {
  const { dataset, run, ready } = useRunQueryState();
  return useQuery({
    queryKey: ["analysis", "readiness", dataset, run, caseStudyId],
    queryFn: () =>
      apiGet<ReadinessResponse>(`/analysis/readiness/${caseStudyId}`),
    enabled: ready && !!caseStudyId,
    staleTime: 5 * 60 * 1000,
  });
}

export function useTargetConfigAudit(variable: string | null) {
  const { dataset, run, ready } = useRunQueryState();
  return useQuery({
    queryKey: ["analysis", "target-config", dataset, run, variable],
    queryFn: () =>
      apiGet<TargetConfigAudit>("/analysis/target-config-audit", {
        variable: variable ?? undefined,
      }),
    enabled: ready,
    staleTime: 5 * 60 * 1000,
  });
}

export function useDomainBreakdown(
  variable: string | null,
  domainVariable: string,
) {
  const { dataset, run, ready } = useRunQueryState();
  const trimmedDomainVariable = domainVariable.trim();
  return useQuery({
    queryKey: [
      "analysis",
      "domain-breakdown",
      dataset,
      run,
      variable,
      trimmedDomainVariable,
    ],
    queryFn: () =>
      apiGet<DomainBreakdown>("/analysis/domain-breakdown", {
        variable: variable ?? undefined,
        domain_variable: trimmedDomainVariable,
      }),
    enabled: ready && trimmedDomainVariable.length > 0,
    staleTime: 5 * 60 * 1000,
  });
}

export function useDependencyTrace(variable: string | null) {
  const { dataset, run, ready } = useRunQueryState();
  return useQuery({
    queryKey: ["analysis", "dependency", dataset, run, variable],
    queryFn: () =>
      apiGet<DependencyTrace>(`/analysis/dependency/${variable}`, {
        max_nodes: 350,
      }),
    enabled: ready && !!variable,
    staleTime: 10 * 60 * 1000,
  });
}
