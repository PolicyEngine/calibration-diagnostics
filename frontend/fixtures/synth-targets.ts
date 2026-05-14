/**
 * Deterministic synthetic target set for fixture mode.
 *
 * Generates ~2,800 rows distributed across variables / geo levels / error
 * buckets / status so the Target Explorer feels like the real backend
 * without needing one running. Seeded RNG → identical on every reload.
 */

import { STATE_FIPS_TO_CODE } from "@/lib/geo-names";

interface SynthTarget {
  target_idx: number;
  target_id: number | null;
  target_name: string;
  variable: string;
  geo_level: "national" | "state" | "district";
  geographic_id: string | null;
  geo_display_name: string | null;
  domain_variable: string | null;
  constraints: string[];
  target_value: number;
  estimate: number;
  rel_error: number;
  abs_error: number;
  abs_rel_error: number;
  loss_contribution: number;
  included: boolean;
}

const VARIABLES = [
  { name: "adjusted_gross_income",  geo: ["national", "state"],           difficulty: 0.07, weight: 0.15 },
  { name: "household_count",         geo: ["state", "district"],           difficulty: 0.06, weight: 0.14 },
  { name: "snap_enrollment",         geo: ["national", "state", "district"], difficulty: 0.22, weight: 0.13 },
  { name: "tax_unit_eitc",           geo: ["national", "state"],           difficulty: 0.18, weight: 0.10 },
  { name: "medicaid",                geo: ["state", "district"],           difficulty: 0.14, weight: 0.10 },
  { name: "person_count",            geo: ["state", "district"],           difficulty: 0.05, weight: 0.10 },
  { name: "ssi",                     geo: ["national", "state"],           difficulty: 0.16, weight: 0.06 },
  { name: "wic_enrollment",          geo: ["national", "state"],           difficulty: 0.28, weight: 0.05 },
  { name: "self_employment_income",  geo: ["national", "state"],           difficulty: 0.12, weight: 0.05 },
  { name: "tax_unit_ctc",            geo: ["national", "state"],           difficulty: 0.10, weight: 0.04 },
  { name: "social_security",         geo: ["national", "state"],           difficulty: 0.08, weight: 0.04 },
  { name: "ui_benefit",              geo: ["national", "state"],           difficulty: 0.20, weight: 0.04 },
];

const STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA",
  "KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT",
  "VA","WA","WV","WI","WY","DC",
];

const DISTRICTS_PER_STATE: Record<string, number> = {
  CA: 52, TX: 38, FL: 28, NY: 26, PA: 17, IL: 17, OH: 15, GA: 14, NC: 14,
  MI: 13, NJ: 12, VA: 11, WA: 10, AZ: 9, MA: 9, IN: 9, TN: 9, MD: 8, MO: 8,
  MN: 8, WI: 8, CO: 8, AL: 7, SC: 7, KY: 6, LA: 6, OR: 6, CT: 5, OK: 5,
  AR: 4, IA: 4, KS: 4, MS: 4, NV: 4, NM: 3, UT: 4, NE: 3, WV: 2, HI: 2,
  ID: 2, ME: 2, NH: 2, RI: 2, MT: 2, AK: 1, DE: 1, ND: 1, SD: 1, VT: 1,
  WY: 1, DC: 1,
};

const DOMAIN_CONSTRAINTS = [
  null,
  "tax_unit_is_filer",
  "age_group_child",
  "age_group_senior",
  "below_poverty",
  "household_has_children",
];

// Deterministic pseudo-random generator (mulberry32).
function makeRng(seed: number) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rng: () => number, mean: number, sd: number): number {
  // Box–Muller
  const u1 = Math.max(rng(), 1e-9);
  const u2 = rng();
  return mean + sd * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

let _cache: SynthTarget[] | null = null;

export function getSynthTargets(): SynthTarget[] {
  if (_cache) return _cache;

  const rng = makeRng(20260512);
  const rows: SynthTarget[] = [];
  let idx = 0;
  let nextId = 1000;

  for (const v of VARIABLES) {
    for (const geo of v.geo) {
      const entries =
        geo === "national"
          ? [{ id: null, display: null }]
          : geo === "state"
            ? STATES.map((s) => ({ id: s, display: s }))
            : STATES.flatMap((s) =>
                Array.from(
                  { length: DISTRICTS_PER_STATE[s] ?? 1 },
                  (_, i) => ({
                    id: `${s}-${String(i + 1).padStart(2, "0")}`,
                    display: `${s}-${String(i + 1).padStart(2, "0")}`,
                  }),
                ),
              );

      for (const entry of entries) {
        for (const constraint of DOMAIN_CONSTRAINTS) {
          // Not every (variable × geo × constraint) combo exists. Sparsify.
          if (constraint !== null && rng() > 0.25) continue;

          const value = Math.round(
            geo === "national" ? 1_000_000 + rng() * 50_000_000 :
            geo === "state"    ? 10_000   + rng() * 2_000_000  :
                                  1_000    + rng() * 200_000,
          );

          // Relative error follows a distribution centred on 0, sd scaled by
          // the variable's "difficulty" and a small geo-level bias.
          const geoBias = geo === "district" ? 1.3 : geo === "state" ? 1.0 : 0.7;
          const relError = gaussian(rng, 0, v.difficulty * geoBias);
          const absRelError = Math.abs(relError);
          const estimate = Math.round(value * (1 + relError));
          const absError = Math.abs(estimate - value);
          const lossContribution = (relError * relError) * v.weight;

          // 88% included; less-targeted constraints more likely to be skipped.
          const included =
            constraint === null
              ? rng() < 0.95
              : rng() < 0.78;

          const constraintList: string[] = [];
          if (constraint) constraintList.push(`${constraint} == 1`);
          if (geo === "state" && entry.id) constraintList.push(`state == ${entry.id}`);

          const constraintSuffix =
            constraintList.length === 0 ? "[]" : `[${constraintList.join(",")}]`;
          const target_name = `${geo}/${v.name}/${entry.id ?? "US"}/${constraintSuffix}`;

          rows.push({
            target_idx: idx,
            target_id: nextId++,
            target_name,
            variable: v.name,
            geo_level: geo as SynthTarget["geo_level"],
            geographic_id: entry.id,
            geo_display_name: entry.display,
            domain_variable: constraint,
            constraints: constraintList,
            target_value: value,
            estimate,
            rel_error: relError,
            abs_error: absError,
            abs_rel_error: absRelError,
            loss_contribution: lossContribution,
            included,
          });
          idx++;
        }
      }
    }
  }
  _cache = rows;
  return rows;
}

/* ───────────────── Query helpers (filter / paginate) ───────────────── */

type Param = string | number | boolean | undefined | null | (string | number)[];
type Params = Record<string, Param>;

function asArray(v: Param): string[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v.map(String) : [String(v)];
}

const ERROR_BUCKETS: Record<string, [number, number]> = {
  excellent: [0.0, 0.05],
  good:      [0.05, 0.20],
  poor:      [0.20, 0.50],
  extreme:   [0.50, Infinity],
};

export function filterTargets(params: Params): SynthTarget[] {
  let rows = getSynthTargets();
  const search = (params.search as string | undefined)?.toLowerCase();
  const variables = asArray(params.variable);
  const geoLevels = asArray(params.geo_level);
  const errorBuckets = asArray(params.error_bucket);
  const includedOnly = params.included_only;
  const stateFipsList: number[] = (() => {
    const raw = params.state_fips;
    if (raw === undefined || raw === null) return [];
    const arr = Array.isArray(raw) ? raw : [raw];
    return arr.map((x) => Number(x)).filter((n) => Number.isFinite(n));
  })();

  if (includedOnly === true || includedOnly === "true") {
    rows = rows.filter((r) => r.included);
  } else if (includedOnly === false || includedOnly === "false") {
    rows = rows.filter((r) => !r.included);
  }
  if (variables.length) rows = rows.filter((r) => variables.includes(r.variable));
  if (geoLevels.length) rows = rows.filter((r) => geoLevels.includes(r.geo_level));
  if (stateFipsList.length) {
    const codes = stateFipsList
      .map((f) => STATE_FIPS_TO_CODE[f])
      .filter(Boolean);
    if (codes.length === 0) {
      rows = [];
    } else {
      rows = rows.filter((r) =>
        codes.some(
          (code) =>
            r.geographic_id === code ||
            (r.geographic_id?.startsWith(code + "-") ?? false),
        ),
      );
    }
  }
  if (errorBuckets.length) {
    const ranges = errorBuckets
      .map((b) => ERROR_BUCKETS[b])
      .filter(Boolean);
    if (ranges.length === 0) rows = [];
    else
      rows = rows.filter((r) =>
        ranges.some(([lo, hi]) => r.abs_rel_error >= lo && r.abs_rel_error < hi),
      );
  }
  if (search) {
    rows = rows.filter(
      (r) =>
        r.target_name.toLowerCase().includes(search) ||
        r.variable.toLowerCase().includes(search) ||
        (r.domain_variable?.toLowerCase().includes(search) ?? false),
    );
  }
  return rows;
}

export function listTargetsFixture(params: Params) {
  const filtered = filterTargets(params);
  const sortBy = (params.sort_by as string | undefined) ?? "loss_contribution";
  const sortOrder = (params.sort_order as string | undefined) ?? "desc";
  const asc = sortOrder === "asc";
  const sorted = [...filtered].sort((a, b) => {
    const av = (a as never)[sortBy] ?? 0;
    const bv = (b as never)[sortBy] ?? 0;
    return asc ? Number(av) - Number(bv) : Number(bv) - Number(av);
  });
  const offset = Number(params.offset ?? 0);
  const limit = Number(params.limit ?? 50);
  return {
    items: sorted.slice(offset, offset + limit),
    total: filtered.length,
    offset,
    limit,
  };
}

export function facetsFixture(params: Params) {
  const exclude = (key: string) => {
    const next = { ...params };
    delete next[key];
    return filterTargets(next);
  };
  const countBy = (rows: SynthTarget[], key: keyof SynthTarget) => {
    const m = new Map<string, { count: number; total_loss: number }>();
    for (const r of rows) {
      const k = String(r[key] ?? "(none)");
      const e = m.get(k) ?? { count: 0, total_loss: 0 };
      e.count += 1;
      e.total_loss += r.loss_contribution;
      m.set(k, e);
    }
    return [...m.entries()]
      .map(([value, v]) => ({ value, count: v.count, total_loss: v.total_loss }))
      .sort((a, b) => b.total_loss - a.total_loss);
  };
  const errorBucketCounts = (rows: SynthTarget[]) =>
    Object.entries(ERROR_BUCKETS).map(([name, [lo, hi]]) => ({
      value: name,
      count: rows.filter((r) => r.abs_rel_error >= lo && r.abs_rel_error < hi).length,
    }));

  return {
    by_variable: countBy(exclude("variable"), "variable"),
    by_geo_level: countBy(exclude("geo_level"), "geo_level"),
    by_error_bucket: errorBucketCounts(exclude("error_bucket")),
    by_status: [
      { value: "included", count: filterTargets(params).filter((r) => r.included).length },
      { value: "skipped",  count: filterTargets(params).filter((r) => !r.included).length },
    ],
    buckets_definition: Object.fromEntries(
      Object.entries(ERROR_BUCKETS).map(([k, [lo, hi]]) => [
        k,
        { min: lo, max: hi === Infinity ? null : hi },
      ]),
    ),
  };
}
