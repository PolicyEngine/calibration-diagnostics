import { humanizeName } from "@/components/shared/format";
import type { MicrocosmTargetRow } from "@/lib/api/hooks/use-microcosm";

export function titleFromIdentifier(value: string | null | undefined): string {
  if (!value) return "";
  const leaf = value.split(/[.#:]/).filter(Boolean).at(-1) ?? value;
  return humanizeName(leaf.replace(/[^a-zA-Z0-9]+/g, "_"));
}

// The targets page's Dimensions column: a target's dimension values, else
// its group-by value, else "All". A target whose identity spans several facts
// and whose hierarchy lists no group-by pair it carries says it combines
// several source cells, after any dimensions its hierarchy lists. The
// hierarchy leaving the pair out does not show that the facts differ in it, so
// the cell names no dimension as varying; "All" would misstate what the FSA
// balance excluding Parent PLUS leaves out.
export function dimensionSummary(row: MicrocosmTargetRow): string {
  const dims = row.target_dimensions?.map((dim) => dim.value).filter(Boolean) ?? [];
  if (row.chronicle?.layout_groupby_unlisted_across_facts) {
    return [...dims, "Combines several source cells"].join(" · ");
  }
  if (dims.length) return dims.join(" · ");
  const group = row.chronicle?.layout_groupby_value_id;
  if (group && group !== "all") return humanizeName(group);
  return "All";
}
