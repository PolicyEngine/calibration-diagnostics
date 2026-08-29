import type {
  TargetMatchingSummary,
  TargetMatchKind,
} from "./target-surface-matcher";
import type {
  TargetRepresentation,
  TargetRowRepresentation,
} from "./target-representation";

export function targetRepresentationLabel(
  representation: TargetRepresentation | TargetRowRepresentation,
): string {
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
    return "Matched by structured source ID, statistic ID, measure, and raw dimensions.";
  }
  return "Not matched across releases.";
}

function joinedList(items: string[]): string {
  if (items.length < 2) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items.at(-1)}`;
}

function formatCount(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

export function targetMatchingSummaryText(summary: TargetMatchingSummary): string {
  const methods = [
    [summary.matched_by.base_name, "by normalized target name"],
    [summary.matched_by.chronicle_fact_key, "by Chronicle fact key"],
    [summary.matched_by.structured_identity, "by structured identity"],
  ] as const;
  const matched = methods.reduce((sum, [count]) => sum + count, 0);
  const methodText = joinedList(
    methods.flatMap(([count, label]) => count ? [`${formatCount(count)} ${label}`] : []),
  );
  const ambiguous = Object.values(summary.ambiguous_key_groups)
    .reduce((sum, count) => sum + count, 0);
  const parts = [
    `${targetRepresentationLabel(summary.current_representation)} current release → ${targetRepresentationLabel(summary.candidate_representation)} candidate.`,
    matched
      ? `Matched ${methodText}.`
      : "No targets were matched across releases.",
  ];
  if (ambiguous) {
    parts.push(
      `${formatCount(ambiguous)} ambiguous identity ${ambiguous === 1 ? "group was" : "groups were"} left unmatched.`,
    );
  }
  return parts.join(" ");
}
