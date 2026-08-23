import { EmptyState } from "@/components/shared/empty-state";
import { fmt, fmtCompact } from "@/components/shared/format";
import { SectionCard } from "@/components/shared/section-card";
import { StatusPill, type StatusTone } from "@/components/shared/status-pill";
import {
  shapeExternalValidations,
  type ExternalValidationColumnLedger,
  type ExternalValidationKeyRow,
  type ExternalValidationSurfaceRow,
} from "@/lib/microcosm/external-validations";

function ledgerTone(classification: string | null): StatusTone {
  switch (classification?.toLowerCase()) {
    case "matched":
      return "success";
    case "gap":
      return "danger";
    case "explained":
      return "info";
    default:
      return "neutral";
  }
}

function euroValue(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  if (Math.abs(value) >= 1_000) return fmtCompact(value);
  return new Intl.NumberFormat("en", { maximumFractionDigits: 6 }).format(value);
}

function LedgerChip({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="min-w-28 rounded-md border border-border bg-muted/20 px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="mt-0.5 font-mono text-lg font-semibold tabular-nums text-foreground">
        {fmt(value, { digits: 0 })}
      </div>
    </div>
  );
}

function KeyRowsTable({ rows }: { rows: ExternalValidationKeyRow[] }) {
  if (!rows.length) {
    return <EmptyState title="No key rows published." variant="compact" />;
  }
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-border text-[11px] uppercase tracking-wider text-muted-foreground">
            <th className="px-3 py-2 font-semibold">Column</th>
            <th className="px-3 py-2 text-right font-semibold">EUROMOD €</th>
            <th className="px-3 py-2 text-right font-semibold">Axiom €</th>
            <th className="px-3 py-2 text-right font-semibold">Δ €</th>
            <th className="px-3 py-2 font-semibold">Classification</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.column} className="border-b border-border/60 last:border-b-0">
              <td className="px-3 py-2">
                <div className="font-mono font-medium text-foreground">{row.column}</div>
                {row.label ? (
                  <div className="text-xs text-muted-foreground">{row.label}</div>
                ) : null}
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums">
                {euroValue(row.euromodEur)}
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums">
                {euroValue(row.axiomEur)}
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums">
                {euroValue(row.deltaAxiomMinusEuromodEur)}
              </td>
              <td className="px-3 py-2">
                {row.classification ? (
                  <StatusPill tone={ledgerTone(row.classification)}>
                    {row.classification}
                  </StatusPill>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
                {row.explanationClass ? (
                  <div className="mt-1 font-mono text-[10px] text-muted-foreground">
                    {row.explanationClass}
                  </div>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ColumnLedger({ ledger }: { ledger: ExternalValidationColumnLedger }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        <LedgerChip label="Matched" value={ledger.matched} />
        <LedgerChip label="Explained" value={ledger.explained} />
        <LedgerChip label="Gap" value={ledger.gap} />
        <LedgerChip label="Unclassified" value={ledger.unclassified} />
      </div>
      <p className="text-xs text-muted-foreground">
        {fmt(ledger.substantiveColumns, { digits: 0 })} substantive columns of{" "}
        {fmt(ledger.totalColumns, { digits: 0 })} total · tolerance €
        {ledger.toleranceEur == null ? "—" : euroValue(ledger.toleranceEur)}
      </p>
      <KeyRowsTable rows={ledger.keyRows} />
    </div>
  );
}

function ValidationSurfaceTable({ rows }: { rows: ExternalValidationSurfaceRow[] }) {
  if (!rows.length) {
    return <EmptyState title="No validation surface published." variant="compact" />;
  }
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-border text-[11px] uppercase tracking-wider text-muted-foreground">
            <th className="px-3 py-2 font-semibold">Name</th>
            <th className="px-3 py-2 text-right font-semibold">Value</th>
            <th className="px-3 py-2 text-right font-semibold">Year</th>
            <th className="px-3 py-2 font-semibold">Publisher</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.name} className="border-b border-border/60 last:border-b-0">
              <td className="px-3 py-2">
                <div className="font-mono text-xs font-medium text-foreground">{row.name}</div>
                {row.concept ? (
                  <div className="text-xs text-muted-foreground">{row.concept}</div>
                ) : null}
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums">
                {fmtCompact(row.value)}
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                {fmt(row.year, { digits: 0 })}
              </td>
              <td className="px-3 py-2 font-mono text-xs">
                {row.publisher ?? "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ExternalValidationsPanel({ releaseManifest }: { releaseManifest: unknown }) {
  const validations = shapeExternalValidations(releaseManifest);
  if (!validations.length) return null;

  return (
    <>
      {validations.map((validation) => (
        <SectionCard
          key={validation.key}
          title={`External validation — ${validation.comparator ?? validation.key}`}
          description={validation.description}
        >
          <div className="flex flex-col gap-5">
            {validation.columnLedger ? (
              <ColumnLedger ledger={validation.columnLedger} />
            ) : null}
            {validation.columnLedger && validation.validationSurface.length ? (
              <div className="border-t border-border" />
            ) : null}
            <ValidationSurfaceTable rows={validation.validationSurface} />
          </div>
        </SectionCard>
      ))}
    </>
  );
}
