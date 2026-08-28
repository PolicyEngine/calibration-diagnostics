import type { ReactNode } from "react";

export const overviewMetricLabelTypographyClassName =
  "text-[10px] font-semibold uppercase leading-tight tracking-[0.12em]";

export const overviewMetricLabelClassName =
  `${overviewMetricLabelTypographyClassName} text-muted-foreground`;

export const overviewMetricValueClassName =
  "font-semibold tabular-nums text-foreground";

export function OverviewMetric({ label, value }: { label: ReactNode; value: string }) {
  return (
    <div className="min-w-0 flex-1 px-4 py-3.5 text-center sm:px-5">
      <div
        className={`flex h-8 items-start justify-center ${overviewMetricLabelClassName}`}
      >
        {label}
      </div>
      <div
        className={`mt-1 truncate text-2xl ${overviewMetricValueClassName}`}
        title={value}
      >
        {value}
      </div>
    </div>
  );
}
