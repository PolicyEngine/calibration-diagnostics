export const targetKeys = {
  all: ["targets"] as const,
  list: (params: object) =>
    [...targetKeys.all, "list", params] as const,
  search: (variable: string) =>
    [...targetKeys.all, "search", variable] as const,
  worstFit: () =>
    [...targetKeys.all, "worst-fit"] as const,
  errorDecomposition: (id: number) =>
    [...targetKeys.all, "error-decomp", id] as const,
  provenance: (id: number) =>
    [...targetKeys.all, "provenance", id] as const,
  eligibilityAudit: (id: number, params: object) =>
    [...targetKeys.all, "eligibility", id, params] as const,
  constraintDiff: (id: number) =>
    [...targetKeys.all, "constraint-diff", id] as const,
  contributors: (id: number, params: object) =>
    [...targetKeys.all, "contributors", id, params] as const,
  convergence: (id: number) =>
    [...targetKeys.all, "convergence", id] as const,
};

export const weightKeys = {
  all: ["weights"] as const,
  distribution: (params: object) =>
    [...weightKeys.all, "distribution", params] as const,
  histogram: (params: object) =>
    [...weightKeys.all, "histogram", params] as const,
};

export const strataKeys = {
  byId: (id: number) => ["strata", id] as const,
};
