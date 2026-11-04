import { humanizeName } from "@/components/shared/format";
import type { MicrocosmTargetRow } from "@/lib/api/hooks/use-microcosm";

export function titleFromIdentifier(value: string | null | undefined): string {
  if (!value) return "";
  const leaf = value.split(/[.#:]/).filter(Boolean).at(-1) ?? value;
  return humanizeName(leaf.replace(/[^a-zA-Z0-9]+/g, "_"));
}

// The targets page's Dimensions column.
export function dimensionSummary(row: MicrocosmTargetRow): string {
  const dims = row.target_dimensions?.map((dim) => dim.value).filter(Boolean) ?? [];
  if (dims.length) return dims.join(" · ");
  const group = row.chronicle?.layout_groupby_value_id;
  if (group && group !== "all") return humanizeName(group);
  return "All";
}
