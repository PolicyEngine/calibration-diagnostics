// The shared formatter is absent from the input. Only aggregate's old title
// calls this stand-in in the 132-row comparison (reported below).
export const formatterCalls: string[] = [];
function humanizeName(value: string): string {
  formatterCalls.push(value);
  return value === 'loan_type' ? 'loan type' : `[humanizeName:${value}]`;
}
type MicrocosmTargetRow = any;

export function titleFromIdentifier(value: string | null | undefined): string {
  if (!value) return "";
  const leaf = value.split(/[.#:]/).filter(Boolean).at(-1) ?? value;
  return humanizeName(leaf.replace(/[^a-zA-Z0-9]+/g, "_"));
}

// The targets page's Dimensions column: a target's dimension values, else
// its group-by value, else "All". A target whose facts differ in their
// group-by value (the FSA balance excluding Parent PLUS sums five loan types)
// says it combines several, after any dimensions its facts share: "All" would
// misstate what it leaves out.
export function dimensionSummary(row: MicrocosmTargetRow): string {
  const dims = row.target_dimensions?.map((dim) => dim.value).filter(Boolean) ?? [];
  if (row.chronicle?.layout_groupby_value_varies) {
    const groupBy = titleFromIdentifier(row.chronicle.layout_groupby_dimension);
    const combined = ["Combines several", groupBy, "values"].filter(Boolean).join(" ");
    return [...dims, combined].join(" · ");
  }
  if (dims.length) return dims.join(" · ");
  const group = row.chronicle?.layout_groupby_value_id;
  if (group && group !== "all") return humanizeName(group);
  return "All";
}
