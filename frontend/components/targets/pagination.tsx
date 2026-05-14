"use client";

import { formatNumber } from "@policyengine/ui-kit";
import { useTargetFilters } from "@/lib/target-filters-context";

interface Props {
  total: number;
}

const PAGE_SIZE_OPTIONS = [25, 50, 100, 200];

export function TargetPagination({ total }: Props) {
  const { filters, setFilters } = useTargetFilters();
  const { page, pageSize } = filters;
  const lastPage = Math.max(0, Math.ceil(total / pageSize) - 1);
  const from = total === 0 ? 0 : page * pageSize + 1;
  const to = Math.min(total, (page + 1) * pageSize);

  const btn =
    "h-8 min-w-8 rounded border border-border bg-background px-2 text-sm " +
    "hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed";

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
      <div className="text-muted-foreground">
        {total === 0 ? (
          "No matching targets"
        ) : (
          <>
            <span className="font-medium text-foreground">
              {formatNumber(from)}–{formatNumber(to)}
            </span>{" "}
            of <span className="font-medium text-foreground">{formatNumber(total)}</span> targets
          </>
        )}
      </div>

      <div className="flex items-center gap-3">
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          Rows
          <select
            className="h-8 rounded border border-border bg-background px-1 text-sm"
            value={pageSize}
            onChange={(e) =>
              setFilters({ pageSize: Number(e.target.value), page: 0 })
            }
          >
            {PAGE_SIZE_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>

        <div className="flex items-center gap-1">
          <button
            type="button"
            className={btn}
            disabled={page <= 0}
            onClick={() => setFilters({ page: 0 })}
            aria-label="First page"
          >
            «
          </button>
          <button
            type="button"
            className={btn}
            disabled={page <= 0}
            onClick={() => setFilters({ page: page - 1 })}
            aria-label="Previous page"
          >
            ‹
          </button>
          <span className="px-2 text-muted-foreground">
            Page <span className="font-medium text-foreground">{page + 1}</span>{" "}
            of {lastPage + 1}
          </span>
          <button
            type="button"
            className={btn}
            disabled={page >= lastPage}
            onClick={() => setFilters({ page: page + 1 })}
            aria-label="Next page"
          >
            ›
          </button>
          <button
            type="button"
            className={btn}
            disabled={page >= lastPage}
            onClick={() => setFilters({ page: lastPage })}
            aria-label="Last page"
          >
            »
          </button>
        </div>
      </div>
    </div>
  );
}
