"""Step 3: undo one part of a fix at a time in a scratch worktree at 43c62d2,
then run the calibration-tree package suite and the frontend suite.
Usage: python3 step3_mutations.py <worktree> <logdir> [mutation-id ...]"""
import json, pathlib, re, subprocess, sys

W = pathlib.Path(sys.argv[1]); LOG = pathlib.Path(sys.argv[2]); ONLY = set(sys.argv[3:])
LA = "frontend/packages/calibration-tree/src/latest-artifact.ts"
SG = "frontend/lib/microcosm/statistic-groups.ts"
TF = "frontend/components/microcosm/target-filter-options.ts"

CL_OLD = "return { level: levels.length > 1 ? null : (levels[0] ?? none), levels };"
CO_OLD = '''  const count =
    typeof value === "string" && /^\\s*\\d+\\s*$/.test(value) ? Number(value) : numberOrNull(value);
  return count != null && Number.isSafeInteger(count) && count >= 0 ? count : null;'''
RG_OLD = '''function repeatsGeography(rows: TargetRow[], key: string): boolean {
  let carried = false;'''

M = [
 ("categoryLevels:first-row-level", LA, CL_OLD,
  "return { level: group[0]?.level == null ? none : String(group[0].level), levels };"),
 ("categoryLevels:single-level-null", LA, CL_OLD,
  "return { level: levels.length >= 1 ? null : none, levels };"),
 ("statisticGroupKey:level-alone", SG, 'const levels = row.levels ?? [row.level ?? ""];',
  'const levels = [row.level ?? ""];'),
 ("statisticGroupKey:join-empty", SG, 'levels.join("+")', 'levels.join("")'),
 ("sourceFilterOptions:label-is-value", TF, "label: releaseLabels.get(value) ?? sourceLabel(value),", "label: value,"),
 ("levelFilterOptions:label-is-value", TF, "label: explorerGeographyLevelLabel(value) }", "label: value }"),
 ("countOrNull:numberOrNull", LA, CO_OLD, "  return numberOrNull(value);"),
 ("countOrNull:accept-2.5", LA, CO_OLD, CO_OLD.replace("\\d+\\s*$", "\\d+(\\.\\d+)?\\s*$").replace("Number.isSafeInteger(count)", "Number.isFinite(count)")),
 ("countOrNull:accept--1", LA, CO_OLD, CO_OLD.replace("^\\s*\\d+", "^\\s*-?\\d+").replace(" && count >= 0", "")),
 ("countOrNull:accept-space", LA, CO_OLD, CO_OLD.replace("^\\s*\\d+\\s*$", "^\\s*\\d*\\s*$")),
 ("shownChronicle:return-row.chronicle", LA,
  "if (memberFactCount == null || memberFactCount <= 1) return row.chronicle;", "return row.chronicle;"),
]
for field in ["source_record_id", "fact_key", "semantic_fact_key", "aggregate_fact_key", "legacy_fact_key",
              "layout_groupby_value_id", "universe_constraint_set_key", "universe_constraint_count"]:
    M.append((f"shownChronicle:keep-{field}", LA, f"\n    {field}: null,\n", "\n"))
M += [
 ("targetResponseRow:row.chronicle", LA, "chronicle: shownChronicle(row),", "chronicle: row.chronicle,"),
 ("lookup:candidate.chronicle", LA, "const chronicle = asObject(shownChronicle(candidate));",
  "const chronicle = asObject(candidate.chronicle);"),
 ("investigationSearches:drop-member-facts", LA,
  '    ...memberFactKeys.map((key): [string, string | null] => ["Member fact", key]),\n', ""),
 ("investigationSearches:raw-chronicle", LA, "const chronicle = asObject(shownChronicle(row));\n  const metadata",
  "const chronicle = asObject(row.chronicle);\n  const metadata"),
 ("repeatsGeography:false", LA, RG_OLD, RG_OLD.replace("{\n", "{\n  return false;\n", 1)),
 ("repeatsGeography:one-value-per-geography", LA, RG_OLD,
  '''function repeatsGeography(rows: TargetRow[], key: string): boolean {
  const byGeography = new Map<string, Set<string>>();
  for (const row of rows) {
    const value = rowFacetValue(row, key);
    if (!value) continue;
    const geography = rowFacetValue(row, "geography") ?? "";
    (byGeography.get(geography) ?? byGeography.set(geography, new Set()).get(geography)!).add(value);
  }
  return byGeography.size > 0 && [...byGeography.values()].every((values) => values.size <= 1);
  let carried = false;'''),
]

def run(cwd, name):
    p = subprocess.run(["bun", "test"], cwd=W / cwd, capture_output=True, text=True)
    out = p.stdout + p.stderr
    (LOG / f"{name}.log").write_text(out)
    fails = sorted(set(re.findall(r"^\(fail\) (.+?)(?: \[[\d.]+m?s\])?$", out, re.M)))
    counts = re.findall(r"^ *(\d+) (pass|fail)$", out, re.M)
    errors = re.findall(r"^ *(\d+) errors?$", out, re.M)
    return {"counts": counts, "errors": errors, "fails": fails}

results = {}
for mid, path, old, new in M:
    if ONLY and mid not in ONLY: continue
    f = W / path; src = f.read_text()
    assert src.count(old) == 1, (mid, src.count(old))
    f.write_text(src.replace(old, new))
    try:
        safe = mid.replace(":", "_")
        # The frontend suite also runs the calibration-tree package's tests.
        results[mid] = {"frontend": run("frontend", f"step3-{safe}-frontend")}
    finally:
        f.write_text(src)
    r = results[mid]
    print(mid, "| frontend", r["frontend"]["counts"], r["frontend"]["errors"], r["frontend"]["fails"], flush=True)
(LOG / f"step3-results{'-part2' if ONLY else ''}.json").write_text(json.dumps(results, indent=1))
