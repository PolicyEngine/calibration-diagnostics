import type { TargetMatchKind } from "./target-surface-matcher";
import type {
  TargetRepresentation,
  TargetRowRepresentation,
} from "./target-representation";

export function targetRepresentationLabel(
  representation: TargetRepresentation | TargetRowRepresentation,
): string {
  if (representation === "hierarchy") return "Hierarchy format";
  if (representation === "structured") return "Structured format";
  if (representation === "legacy") return "Legacy format";
  if (representation === "mixed") return "Mixed formats";
  return "Unknown format";
}

export function targetRepresentationPairLabel(
  current: TargetRowRepresentation | null,
  candidate: TargetRowRepresentation | null,
): string {
  if (current && candidate) {
    return `${targetRepresentationLabel(current)} → ${targetRepresentationLabel(candidate)}`;
  }
  return targetRepresentationLabel(candidate ?? current ?? "unknown");
}

export function targetMatchKindExplanation(kind: TargetMatchKind | null): string {
  if (kind === "base_name") return "Matched by period-normalized target name.";
  if (kind === "chronicle_fact_key") return "Matched by exact Chronicle fact key.";
  if (kind === "structured_identity") {
    return "Matched by source or provider ID, variable or category ID, measure, and raw dimensions.";
  }
  return "Not matched across releases.";
}
