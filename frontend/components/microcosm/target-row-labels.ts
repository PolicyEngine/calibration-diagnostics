import { humanizeName } from "@/components/shared/format";
import type { MicrocosmTargetRow } from "@/lib/api/hooks/use-microcosm";

export function titleFromIdentifier(value: string | null | undefined): string {
  if (!value) return "";
  const leaf = value.split(/[.#:]/).filter(Boolean).at(-1) ?? value;
  return humanizeName(leaf.replace(/[^a-zA-Z0-9]+/g, "_"));
}

// The targets page's Dimensions column. A target whose identity spans several
// facts reads the dimensions its hierarchy lists, then "Combines several
// source cells", or the phrase alone when its hierarchy lists none. Every
// other target reads its dimension values, else its group-by value, else
// "All".
//
// A several-fact target's Chronicle fields come from one representative
// identity fact, which Microcosm picks by period and then by fact key: a sum's
// resolver sorts the facts by key, and the compiler takes the last fact of the
// latest period (ledger_targets.py:2178-2183, :1232-1245 at 0ff293b). So its
// group-by value, or its lack of one, can change when a fact is renamed, while
// the identity's size and the hierarchy's dimensions cannot. A release without
// a hierarchy has no such dimensions: a schema 6 release's come from the
// representative's metadata, so they can still name one fact's values. "All"
// would claim the target covers every value of what it leaves out, as the FSA
// balance excluding Parent PLUS leaves out Parent PLUS. The phrase names no
// dimension as varying, since a hierarchy that leaves one out does not show
// that the facts differ in it.
export function dimensionSummary(row: MicrocosmTargetRow): string {
  const dims = row.target_dimensions?.map((dim) => dim.value).filter(Boolean) ?? [];
  if (row.chronicle?.identity_spans_several_facts) {
    return [...dims, "Combines several source cells"].join(" · ");
  }
  if (dims.length) return dims.join(" · ");
  const group = row.chronicle?.layout_groupby_value_id;
  if (group && group !== "all") return humanizeName(group);
  return "All";
}
