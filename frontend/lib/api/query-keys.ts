export const targetKeys = {
  all: ["targets"] as const,
  list: (dataset: string | null, run: string | null, params: object) =>
    [...targetKeys.all, dataset, run, "list", params] as const,
  search: (dataset: string | null, run: string | null, variable: string) =>
    [...targetKeys.all, dataset, run, "search", variable] as const,
  worstFit: (dataset: string | null, run: string | null) =>
    [...targetKeys.all, dataset, run, "worst-fit"] as const,
  errorDecomposition: (dataset: string | null, run: string | null, id: number) =>
    [...targetKeys.all, dataset, run, "error-decomp", id] as const,
  provenance: (dataset: string | null, run: string | null, id: number) =>
    [...targetKeys.all, dataset, run, "provenance", id] as const,
  eligibilityAudit: (
    dataset: string | null,
    run: string | null,
    id: number,
    params: object,
  ) =>
    [...targetKeys.all, dataset, run, "eligibility", id, params] as const,
  constraintDiff: (dataset: string | null, run: string | null, id: number) =>
    [...targetKeys.all, dataset, run, "constraint-diff", id] as const,
  contributors: (
    dataset: string | null,
    run: string | null,
    id: number,
    params: object,
  ) =>
    [...targetKeys.all, dataset, run, "contributors", id, params] as const,
  convergence: (dataset: string | null, run: string | null, id: number) =>
    [...targetKeys.all, dataset, run, "convergence", id] as const,
};

export const weightKeys = {
  all: ["weights"] as const,
  distribution: (dataset: string | null, run: string | null, params: object) =>
    [...weightKeys.all, dataset, run, "distribution", params] as const,
  histogram: (dataset: string | null, run: string | null, params: object) =>
    [...weightKeys.all, dataset, run, "histogram", params] as const,
};

export const strataKeys = {
  byId: (dataset: string | null, run: string | null, id: number) =>
    ["strata", dataset, run, id] as const,
};
