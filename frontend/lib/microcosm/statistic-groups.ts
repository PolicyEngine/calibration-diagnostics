// A statistic is one source's category at the levels its targets sit at; its
// measures (amount, count) are options of that one statistic. The targets
// page's statistic picker and the "N statistics" card count both group on
// this key.
export interface StatisticGroupRow {
  source: string;
  variable: string;
  level?: string | null;
  // Every level the category holds. A category at two levels has no single
  // `level`, so the key reads `levels`; a response without it falls back to
  // `level`.
  levels?: string[];
}

export function statisticGroupKey(row: StatisticGroupRow): string {
  const levels = row.levels ?? [row.level ?? ""];
  return [row.source, levels.join("+"), row.variable].join("::");
}

export function statisticGroupCount(rows: readonly StatisticGroupRow[]): number {
  return new Set(rows.map(statisticGroupKey)).size;
}
