import { useQuery } from "@tanstack/react-query";
import { apiGet } from "../client";
import { targetKeys } from "../query-keys";
import { useRunQueryState } from "./use-runs";
import type {
  ErrorDecomposition,
  Provenance,
  EligibilityAudit,
  ConstraintDiffResult,
  Contributor,
  ConvergencePoint,
} from "../types";

export function useErrorDecomposition(targetIdx: number | null) {
  const { dataset, run, ready } = useRunQueryState();
  return useQuery({
    queryKey: targetKeys.errorDecomposition(dataset, run, targetIdx!),
    queryFn: () =>
      apiGet<ErrorDecomposition>(`/targets/${targetIdx}/error-decomposition`),
    enabled: ready && targetIdx !== null,
  });
}

export function useProvenance(targetIdx: number | null) {
  const { dataset, run, ready } = useRunQueryState();
  return useQuery({
    queryKey: targetKeys.provenance(dataset, run, targetIdx!),
    queryFn: () =>
      apiGet<Provenance>(`/targets/${targetIdx}/provenance`),
    enabled: ready && targetIdx !== null,
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
  const { dataset, run, ready } = useRunQueryState();
  return useQuery({
    queryKey: targetKeys.eligibilityAudit(dataset, run, targetIdx!, params ?? {}),
    queryFn: () =>
      apiGet<EligibilityAudit>(`/targets/${targetIdx}/eligibility-audit`, {
        criterion_variable: params!.criterionVariable,
        criterion_operator: params!.criterionOperator,
        criterion_value: params!.criterionValue,
      }),
    enabled: ready && targetIdx !== null && params !== null,
  });
}

export function useConstraintDiff(targetIdx: number | null) {
  const { dataset, run, ready } = useRunQueryState();
  return useQuery({
    queryKey: targetKeys.constraintDiff(dataset, run, targetIdx!),
    queryFn: () =>
      apiGet<ConstraintDiffResult>(`/targets/${targetIdx}/constraint-diff`),
    enabled: ready && targetIdx !== null,
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
  const { dataset, run, ready } = useRunQueryState();
  return useQuery({
    queryKey: targetKeys.contributors(dataset, run, targetIdx!, params),
    queryFn: () =>
      apiGet<Contributor[]>(`/targets/${targetIdx}/contributors`, {
        poverty_only: params.povertyOnly,
        min_g_weight: params.minGWeight,
        sort_by: params.sortBy ?? "g_weight",
        limit: params.limit ?? 50,
        offset: params.offset ?? 0,
      }),
    enabled: ready && targetIdx !== null,
  });
}

export function useTargetConvergence(targetIdx: number | null) {
  const { dataset, run, ready } = useRunQueryState();
  return useQuery({
    queryKey: targetKeys.convergence(dataset, run, targetIdx!),
    queryFn: () =>
      apiGet<ConvergencePoint[]>(`/targets/${targetIdx}/convergence`),
    enabled: ready && targetIdx !== null,
  });
}
