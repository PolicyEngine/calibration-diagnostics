import { useQuery } from "@tanstack/react-query";
import { apiGet } from "../client";
import { targetKeys } from "../query-keys";
import type {
  ErrorDecomposition,
  Provenance,
  EligibilityAudit,
  ConstraintDiffResult,
  Contributor,
  ConvergencePoint,
} from "../types";

export function useErrorDecomposition(targetIdx: number | null) {
  return useQuery({
    queryKey: targetKeys.errorDecomposition(targetIdx!),
    queryFn: () =>
      apiGet<ErrorDecomposition>(`/targets/${targetIdx}/error-decomposition`),
    enabled: targetIdx !== null,
  });
}

export function useProvenance(targetIdx: number | null) {
  return useQuery({
    queryKey: targetKeys.provenance(targetIdx!),
    queryFn: () =>
      apiGet<Provenance>(`/targets/${targetIdx}/provenance`),
    enabled: targetIdx !== null,
  });
}

interface EligibilityParams {
  criterionVariable: string;
  criterionOperator: string;
  criterionValue: number;
}

export function useEligibilityAudit(
  targetIdx: number | null,
  params: EligibilityParams | null,
) {
  return useQuery({
    queryKey: targetKeys.eligibilityAudit(targetIdx!, params ?? {}),
    queryFn: () =>
      apiGet<EligibilityAudit>(`/targets/${targetIdx}/eligibility-audit`, {
        criterion_variable: params!.criterionVariable,
        criterion_operator: params!.criterionOperator,
        criterion_value: params!.criterionValue,
      }),
    enabled: targetIdx !== null && params !== null,
  });
}

export function useConstraintDiff(targetIdx: number | null) {
  return useQuery({
    queryKey: targetKeys.constraintDiff(targetIdx!),
    queryFn: () =>
      apiGet<ConstraintDiffResult>(`/targets/${targetIdx}/constraint-diff`),
    enabled: targetIdx !== null,
  });
}

interface ContributorParams {
  povertyOnly?: boolean;
  minGWeight?: number;
  sortBy?: string;
  limit?: number;
  offset?: number;
}

export function useContributors(
  targetIdx: number | null,
  params: ContributorParams = {},
) {
  return useQuery({
    queryKey: targetKeys.contributors(targetIdx!, params),
    queryFn: () =>
      apiGet<Contributor[]>(`/targets/${targetIdx}/contributors`, {
        poverty_only: params.povertyOnly,
        min_g_weight: params.minGWeight,
        sort_by: params.sortBy ?? "g_weight",
        limit: params.limit ?? 50,
        offset: params.offset ?? 0,
      }),
    enabled: targetIdx !== null,
  });
}

export function useTargetConvergence(targetIdx: number | null) {
  return useQuery({
    queryKey: targetKeys.convergence(targetIdx!),
    queryFn: () =>
      apiGet<ConvergencePoint[]>(`/targets/${targetIdx}/convergence`),
    enabled: targetIdx !== null,
  });
}
