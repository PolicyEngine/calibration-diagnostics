/**
 * A panel's outputs as the release history page lists them (calibration-diagnostics#224): each
 * with a label, a group and a place in the order, from the output's id and the panel's spec.
 *
 * Nothing here adds, subtracts or compares two outputs. Each entry holds one output's own values
 * across builds, with every number removed from a cell that is not `ok`, so a withheld value can
 * never be shown, drawn or derived from further down.
 */
import type { OutputUnit } from "./release-history-format";
import type { Timeline, TimelineBuild, TimelineOutput, TimelineValue } from "./release-history-store";
import type { PanelPresentation } from "./release-history-summary";

export interface OutputEntry {
  /** `<output id>@<period>`: one row of the timeline. */
  key: string;
  id: string;
  period: number;
  unit: OutputUnit;
  /** The group's title, and the label inside that group. */
  group: string;
  label: string;
  /** The label with its reform's name, for a list that mixes groups. */
  fullLabel: string;
  /** A baseline total, or a reform's budgetary impact or target: what a short list ranks. */
  headline: boolean;
  reference: TimelineOutput["reference"];
  /** The official figure in the model's sign, when the reference has a value that is not zero. */
  official: number | null;
  /** One per build, in the order of the timeline's builds, with no number where none is shown. */
  values: TimelineValue[];
}

// Words shown in capitals. A display list only: no output is treated differently for it.
const ACRONYMS = new Set([
  "ahc", "amt", "bhc", "cgt", "ctc", "dla", "eitc", "esa", "jsa", "nics", "pip", "snap", "ssi", "tanf",
  "uc", "uk", "us", "vat", "wic",
]);

function word(token: string): string {
  return ACRONYMS.has(token.toLowerCase()) ? token.toUpperCase() : token;
}

function capitalise(text: string): string {
  return text ? `${text[0].toUpperCase()}${text.slice(1)}` : text;
}

/** "income_tax" as "income tax", with acronyms in capitals. */
function words(id: string): string {
  return id.split("_").filter(Boolean).map(word).join(" ");
}

/** "income_tax" as "Income tax"; "vat" as "VAT". */
export function humanizeId(id: string): string {
  return capitalise(words(id));
}

/** A person group of the spec: `all` reads "everyone". */
function groupLabel(group: string): string {
  return group === "all" ? "everyone" : words(group);
}

/**
 * A baseline item's label. An id that ends in one of the spec's person groups names the group
 * after a comma, and a housing-cost basis goes in brackets: "absolute_poverty_bhc_all" reads
 * "Absolute poverty (BHC), everyone".
 */
export function baselineLabel(id: string, groups: readonly string[]): string {
  const suffix = [...groups]
    .sort((left, right) => right.length - left.length)
    .find((group) => id.endsWith(`_${group}`) && id.length > group.length + 1);
  const stem = suffix ? id.slice(0, -(suffix.length + 1)) : id;
  const text = capitalise(
    stem.split("_").filter(Boolean)
      .map((token) => (token === "bhc" || token === "ahc" ? `(${token.toUpperCase()})` : word(token)))
      .join(" "),
  );
  return suffix ? `${text}, ${groupLabel(suffix)}` : text;
}

const KIND_GROUPS: Readonly<Record<string, string>> = {
  tax: "Receipts",
  benefit: "Spending",
  caseload: "Caseloads",
  population: "Population",
  input: "Incomes in the data",
  income: "Household income",
  rate: "Poverty rates",
  other: "Other programmes",
};

const REFORM_LABELS: Readonly<Record<string, string>> = {
  budgetary_impact: "Budgetary impact",
  households_gaining: "Households with higher net income",
  households_losing: "Households with lower net income",
  people_gaining: "People with higher net income",
  people_losing: "People with lower net income",
  net_income_change_pct: "Change in net income, all households",
};

// Where each kind of reform output sits inside its reform's group.
const REFORM_ORDER: Readonly<Record<string, number>> = {
  target: 0,
  budgetary_impact: 1,
  programme: 2,
  households_gaining: 40,
  households_losing: 41,
  people_gaining: 42,
  people_losing: 43,
  net_income_change_pct: 50,
  decile_relative_change: 51,
  poverty: 60,
};

function decileOf(part: string | undefined): number {
  const decile = Number(part?.split("_")[1]);
  return Number.isFinite(decile) ? decile : 0;
}

function position(list: readonly string[], item: string): number {
  const found = list.indexOf(item);
  return found === -1 ? list.length : found;
}

interface Described {
  group: string;
  label: string;
  fullLabel: string;
  headline: boolean;
  order: number[];
}

function describeBaseline(parts: string[], presentation: PanelPresentation): Described {
  const [, item, decilePart] = parts;
  const index = presentation.baseline.findIndex((candidate) => candidate.id === item);
  const kind = index === -1 ? null : presentation.baseline[index].kind;
  const label = baselineLabel(item, presentation.groups);
  const order = [0, index === -1 ? presentation.baseline.length : index];
  if (decilePart) {
    const decile = decileOf(decilePart);
    return {
      group: `${label} by income decile`,
      label: `Decile ${decile}`,
      fullLabel: `${label}, decile ${decile}`,
      headline: false,
      order: [...order, decile],
    };
  }
  return {
    group: (kind && KIND_GROUPS[kind]) || "Other baseline items",
    label,
    fullLabel: label,
    headline: true,
    order: [...order, 0],
  };
}

function reformOutputLabel(rest: string[]): string {
  const [kind, first, second] = rest;
  if (kind === "target") return `Change in ${words(first ?? "")} (target)`;
  if (kind === "programme") return `Change in ${words(first ?? "")}`;
  if (kind === "decile_relative_change") return `Change in net income, decile ${decileOf(first)}`;
  if (kind === "poverty") {
    const basis = words(first ?? "");
    return `Change in people in poverty, ${basis}, ${groupLabel(second ?? "all")}`;
  }
  return REFORM_LABELS[kind] ?? humanizeId(rest.join("_"));
}

function describeReform(parts: string[], timeline: Timeline, presentation: PanelPresentation): Described {
  const [, reform, ...rest] = parts;
  const kind = rest[0] ?? "";
  const name = timeline.labels[reform]?.label ?? humanizeId(reform);
  const label = reformOutputLabel(rest);
  let minor = 0;
  if (kind === "programme") minor = position(presentation.baseline.map((item) => item.id), rest[1] ?? "");
  if (kind === "decile_relative_change") minor = decileOf(rest[1]);
  if (kind === "poverty") {
    minor = position(presentation.povertyMeasures, rest[1] ?? "") * 100 + position(presentation.groups, rest[2] ?? "");
  }
  return {
    group: `Reform · ${name}`,
    label,
    fullLabel: `${name} · ${label}`,
    headline: kind === "budgetary_impact" || kind === "target",
    order: [1, position(presentation.reforms, reform), REFORM_ORDER[kind] ?? 90, minor],
  };
}

function describe(output: TimelineOutput, timeline: Timeline, presentation: PanelPresentation): Described {
  const parts = output.output.split("/");
  if (parts[0] === "baseline" && parts.length >= 2) return describeBaseline(parts, presentation);
  if (parts[0] === "reform" && parts.length >= 3) return describeReform(parts, timeline, presentation);
  const label = humanizeId(output.output.replace(/\//g, "_"));
  return { group: "Other outputs", label, fullLabel: label, headline: false, order: [2] };
}

/** A value as the page may use it: no number where the cell or the step is not `ok`. */
function shownValue(value: TimelineValue): TimelineValue {
  const hasValue = value.status === "ok" && typeof value.value === "number";
  const hasStep = hasValue && value.changeStatus === "ok";
  return {
    ...value,
    value: hasValue ? value.value : null,
    change: hasStep ? value.change : null,
    relativeChange: hasStep ? value.relativeChange : null,
    changePoints: hasStep ? value.changePoints : null,
  };
}

function compareOrder(left: number[], right: number[]): number {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

export function outputKey(id: string, period: number): string {
  return `${id}@${period}`;
}

/** Every output of the timeline, labelled and in the page's order. */
export function outputEntries(timeline: Timeline, presentation: PanelPresentation): OutputEntry[] {
  return timeline.outputs
    .map((output) => {
      const described = describe(output, timeline, presentation);
      const official = output.reference?.modelSignValue;
      const entry: OutputEntry = {
        key: outputKey(output.output, output.period),
        id: output.output,
        period: output.period,
        unit: output.unit,
        group: described.group,
        label: described.label,
        fullLabel: described.fullLabel,
        headline: described.headline,
        reference: output.reference,
        official: typeof official === "number" && Number.isFinite(official) && official !== 0 ? official : null,
        values: output.values.map(shownValue),
      };
      return { entry, order: described.order };
    })
    .sort((left, right) =>
      compareOrder(left.order, right.order) ||
      (left.entry.id < right.entry.id ? -1 : left.entry.id > right.entry.id ? 1 : 0) ||
      left.entry.period - right.entry.period
    )
    .map(({ entry }) => entry);
}

/** The entries of one period, by group, in the page's order. */
export function groupedOutputs(entries: readonly OutputEntry[]): Map<string, OutputEntry[]> {
  const groups = new Map<string, OutputEntry[]>();
  for (const entry of entries) groups.set(entry.group, [...(groups.get(entry.group) ?? []), entry]);
  return groups;
}

/** The periods the timeline measures, ascending. */
export function timelinePeriods(entries: readonly OutputEntry[]): number[] {
  return [...new Set(entries.map((entry) => entry.period))].sort((left, right) => left - right);
}

/**
 * The newest build on the axis that holds a value for the output, and that value. A withdrawn
 * build's value is never the latest: the publisher took the build back.
 */
export function latestValue(
  entry: OutputEntry,
  builds: ReadonlyArray<Pick<TimelineBuild, "withdrawn">>,
): { index: number; value: number } | null {
  for (let index = entry.values.length - 1; index >= 0; index -= 1) {
    const value = entry.values[index].value;
    if (value !== null && !builds[index]?.withdrawn) return { index, value };
  }
  return null;
}

/** In one line, where the output's official figure comes from, or why it has none. */
export function referenceLine(entry: OutputEntry): string {
  const reference = entry.reference;
  if (!reference) return "none listed for this output.";
  const basis = typeof reference.basis === "string" ? ` (${reference.basis.replace(/_/g, " ")})` : "";
  if (reference.status === "resolved") {
    const facts = Array.isArray(reference.facts) ? reference.facts.length : 0;
    const from = facts > 0 ? `, from ${facts} Chronicle ${facts === 1 ? "record" : "records"}` : "";
    return `a published figure${basis}${from}.`;
  }
  if (reference.status === "citation") {
    const citation = (reference.citation ?? {}) as Record<string, unknown>;
    const named = [citation.publisher, citation.document, citation.edition, citation.row]
      .filter((part): part is string => typeof part === "string" && part.length > 0)
      .join(", ");
    return `cited, with no value yet: ${named || "a publication"}${basis}.`;
  }
  return typeof reference.reason === "string" && reference.reason ? reference.reason : "none.";
}
