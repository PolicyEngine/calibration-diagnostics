"use client";

import { fmt, fmtCompact, fmtSigned, humanizeName } from "@/components/shared/format";
import { StatusPill } from "@/components/shared/status-pill";
import {
  type PopulaceTargetDimension,
  type PopulaceTargetRow,
} from "@/lib/api/hooks/use-populace";

function facetValue(row: PopulaceTargetRow, key: string): string {
  const targetDimension = row.target_dimensions?.find((dim) => dim.key === key);
  if (targetDimension) return targetDimension.value;
  const dim = /^dim(\d+)$/.exec(key);
  if (dim) return row.dims?.[Number(dim[1])] ?? "";
  const value = row[key];
  return typeof value === "string" ? value : "";
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <span className="text-sm text-foreground">{value || "—"}</span>
    </div>
  );
}

function CodeField({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      {value ? (
        <code className="break-all rounded bg-muted/50 px-1 py-0.5 text-xs text-foreground">
          {value}
        </code>
      ) : (
        <span className="text-sm text-muted-foreground">—</span>
      )}
    </div>
  );
}

function titleFromIdentifier(value: string | null | undefined): string {
  if (!value) return "";
  const leaf = value.split(/[.#:]/).filter(Boolean).at(-1) ?? value;
  return humanizeName(leaf.replace(/[^a-zA-Z0-9]+/g, "_"));
}

function periodText(row: PopulaceTargetRow): string {
  const target = row.ledger?.target_period ?? (row.period == null ? null : String(row.period));
  const source = row.ledger?.source_period;
  if (target && source && target !== source) return `${source} → ${target}`;
  return target ?? source ?? "";
}

function measureText(row: PopulaceTargetRow): string {
  return (
    titleFromIdentifier(row.ledger?.measure_concept) ||
    humanizeName(row.variable as string) ||
    titleFromIdentifier(row.ledger?.layout_measure_id)
  );
}

function relativeErrorText(value: number | null): string {
  if (value == null) return "—";
  const digits = Math.abs(value) >= 0.995 ? 2 : 1;
  return fmt(value, { pct: true, digits });
}

function signedRelativeErrorText(value: number | null): string | undefined {
  if (value == null) return undefined;
  const digits = Math.abs(value) >= 0.995 ? 2 : 1;
  return fmtSigned(value, { pct: true, digits });
}

function pointChangeText(value: number | null): React.ReactNode {
  if (value == null) return "—";
  if (Math.abs(value) < 0.00005) return "flat";
  return `${value > 0 ? "+" : ""}${(value * 100).toFixed(2)} pp`;
}

function errorCaption(
  errorKind: PopulaceTargetRow["error_kind"],
  error: number | null,
): string | undefined {
  if (errorKind === "absolute") return error == null ? undefined : `miss ${fmtCompact(error)}`;
  return signedRelativeErrorText(error);
}

function errorField(
  errorKind: PopulaceTargetRow["error_kind"],
  error: number | null,
): string {
  if (errorKind === "absolute") return fmtCompact(error);
  return relativeErrorText(error);
}

function calibrationStatusTone(
  status: PopulaceTargetRow["calibration_status"],
): "success" | "warning" | "neutral" {
  if (status === "included") return "success";
  if (status === "skipped" || status === "not_materialized") return "warning";
  return "neutral";
}

// A horizontal bar for one estimate against the target, scaled to the largest
// magnitude among target/initial/final so the three rows are comparable.
function EstimateBar({
  label,
  value,
  scale,
  tone,
  caption,
}: {
  label: string;
  value: number | null | undefined;
  scale: number;
  tone: "target" | "initial" | "final";
  caption?: string;
}) {
  const width =
    value == null || scale === 0 ? 0 : Math.min(Math.abs(value) / scale, 1) * 100;
  const barColor =
    tone === "target"
      ? "bg-slate-400"
      : tone === "final"
        ? "bg-primary"
        : "bg-amber-400";
  return (
    <div className="flex items-center gap-3">
      <span className="w-20 shrink-0 text-xs text-muted-foreground">{label}</span>
      <div className="relative h-4 flex-1 rounded bg-muted/40">
        <div
          className={`absolute left-0 top-0 h-4 rounded ${barColor}`}
          style={{ width: `${width}%` }}
        />
      </div>
      <span className="flex w-48 shrink-0 justify-end gap-1 text-right text-xs tabular-nums">
        <span>{fmtCompact(value)}</span>
        {caption ? <span className="text-muted-foreground">({caption})</span> : null}
      </span>
    </div>
  );
}

export function PopulaceTargetDetail({
  row,
  dimensions,
  onClose,
}: {
  row: PopulaceTargetRow;
  dimensions: PopulaceTargetDimension[];
  onClose: () => void;
}) {
  const target = typeof row.target === "number" ? row.target : null;
  const initial = typeof row.initial_estimate === "number" ? row.initial_estimate : null;
  const final = typeof row.final_estimate === "number" ? row.final_estimate : null;
  const scale = Math.max(
    Math.abs(target ?? 0),
    Math.abs(initial ?? 0),
    Math.abs(final ?? 0),
  );
  const initialRel =
    typeof row.initial_relative_error === "number" ? row.initial_relative_error : null;
  const finalRel = typeof row.relative_error === "number" ? row.relative_error : null;
  const initialError = typeof row.initial_error === "number" ? row.initial_error : initialRel;
  const finalError = typeof row.final_error === "number" ? row.final_error : finalRel;
  const errorKind = row.error_kind ?? (target === 0 ? "absolute" : "relative");
  const improvement = typeof row.improvement === "number" ? row.improvement : null;
  const within10 =
    typeof row.abs_relative_error === "number" ? row.abs_relative_error <= 0.1 : null;
  const ledger = row.ledger;

  // The axes of variation shown as facets (geography, breakdown dims, …), each
  // resolved on this row. Geography/level are also in the canonical fields above,
  // so skip them here to avoid duplication; show the breakdown dims.
  const shownDims = dimensions.length
    ? dimensions
        .filter((dim) => dim.key !== "geography" && dim.key !== "level")
        .map((dim) => ({ label: dim.label, value: facetValue(row, dim.key) }))
    : row.target_dimensions?.length
      ? row.target_dimensions.map((dim) => ({ label: dim.label, value: dim.value }))
      : (row.dims ?? []).map((value, index) => ({ label: `Breakdown ${index + 1}`, value }));

  return (
    <div className="rounded-lg border border-primary/30 bg-primary/[0.03] shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/70 px-5 py-3">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-primary">
            Ledger target
          </div>
          <div className="text-base font-semibold leading-tight text-foreground">
            {measureText(row) || row.name}
          </div>
          <code className="mt-1 block break-all text-xs text-muted-foreground">
            {ledger?.source_record_id ?? row.name}
          </code>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-muted/60"
        >
          close ✕
        </button>
      </div>

      <div className="grid gap-4 px-5 py-4 lg:grid-cols-2">
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Geography" value={row.geography} />
            <Field label="Source" value={row.source} />
            <Field label="Period" value={periodText(row)} />
            <Field label="Measure" value={measureText(row)} />
            <Field label="Unit" value={ledger?.measure_unit?.toUpperCase()} />
            <Field label="Domain" value={titleFromIdentifier(ledger?.domain)} />
          </div>
          {shownDims.length > 0 && (
            <div className="grid grid-cols-2 gap-3">
              {shownDims.map((dim) => (
                <Field
                  key={dim.label}
                  label={dim.label}
                  value={dim.value.replace(/^AGI in /, "")}
                />
              ))}
            </div>
          )}
          <div className="flex flex-wrap gap-2 pt-1">
            <StatusPill tone={calibrationStatusTone(row.calibration_status)}>
              {row.calibration_status_label ?? "Unknown calibration status"}
            </StatusPill>
            <StatusPill tone={within10 ? "success" : "warning"}>
              {within10 == null ? "—" : within10 ? "within 10%" : "outside 10%"}
            </StatusPill>
          </div>
          {row.calibration_status_reason ? (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-snug text-amber-900">
              {row.calibration_status_reason}
            </div>
          ) : null}
          <div className="grid grid-cols-1 gap-3 border-t border-border/60 pt-3">
            <CodeField label="Fact key" value={ledger?.fact_key} />
            <CodeField label="Source record ID" value={ledger?.source_record_id} />
            <CodeField label="Measure concept" value={ledger?.measure_concept} />
            <CodeField label="Source concept" value={ledger?.source_concept} />
            <CodeField label="Record set" value={ledger?.layout_record_set_id} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <CodeField label="Group-by dimension" value={ledger?.layout_groupby_dimension} />
            <CodeField label="Group-by value" value={ledger?.layout_groupby_value_id} />
            <CodeField label="Layout measure" value={ledger?.layout_measure_id} />
            <CodeField label="Geography ID" value={ledger?.geography_id} />
          </div>
          {ledger?.filters?.length ? (
            <div className="border-t border-border/60 pt-3">
              <div className="mb-2 text-[11px] uppercase tracking-wider text-muted-foreground">
                Filters
              </div>
              <div className="grid gap-2">
                {ledger.filters.map((filter) => (
                  <div
                    key={filter.key}
                    className="grid gap-1 rounded-md border border-border/70 bg-white px-3 py-2 text-xs sm:grid-cols-[9rem_minmax(0,1fr)]"
                  >
                    <span className="font-medium text-muted-foreground">
                      {filter.label}
                    </span>
                    <span className="break-words text-foreground" title={filter.raw_value}>
                      {filter.value}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        <div className="flex flex-col gap-3">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
            Target vs estimates
          </div>
          <p className="text-xs leading-snug text-muted-foreground">
            Initial is the weighted aggregate before calibration; final is the
            weighted aggregate after applying calibrated weights.
          </p>
          {row.estimate_warning ? (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-snug text-amber-900">
              {row.estimate_warning}
            </div>
          ) : null}
          <div className="flex flex-col gap-2">
            <EstimateBar label="Target" value={target} scale={scale} tone="target" />
            <EstimateBar
              label="Initial"
              value={initial}
              scale={scale}
              tone="initial"
              caption={errorCaption(errorKind, initialError)}
            />
            <EstimateBar
              label="Final"
              value={final}
              scale={scale}
              tone="final"
              caption={errorCaption(errorKind, finalError)}
            />
          </div>
          <div className="grid grid-cols-3 gap-3 border-t border-border/60 pt-3 text-sm">
            <Field
              label={errorKind === "absolute" ? "Final abs. miss" : "Final rel. error"}
              value={errorField(errorKind, finalError)}
            />
            <Field
              label={errorKind === "absolute" ? "Initial abs. miss" : "Initial rel. error"}
              value={errorField(errorKind, initialError)}
            />
            <Field
              label={errorKind === "absolute" ? "Miss reduction" : "Improvement"}
              value={
                improvement == null ? (
                  "—"
                ) : errorKind === "absolute" ? (
                  <span className={improvement > 0 ? "text-emerald-700" : "text-rose-700"}>
                    {fmtCompact(improvement)}
                  </span>
                ) : (
                  <span className={improvement > 0 ? "text-emerald-700" : "text-rose-700"}>
                    {pointChangeText(improvement)}
                  </span>
                )
              }
            />
          </div>
        </div>
      </div>
    </div>
  );
}
