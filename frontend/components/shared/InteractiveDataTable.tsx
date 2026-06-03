import { useState, useCallback, useMemo, useRef, useEffect, type HTMLAttributes } from 'react';
import { cn } from '@policyengine/ui-kit';

export interface DataTableColumn<T = Record<string, unknown>> {
  key: string;
  header: string | React.ReactNode;
  format?: (value: unknown, row: T) => string | React.ReactNode;
  align?: 'left' | 'center' | 'right';
  /** Enable sorting for this column. Requires `sortable` on the table. */
  sortable?: boolean;
  /** Enable filtering for this column. Requires `filterable` on the table. */
  filterable?: boolean;
}

export type SortDirection = 'asc' | 'desc';

export interface SortState {
  key: string;
  direction: SortDirection;
}

export interface DataTableProps<T = Record<string, unknown>>
  extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  columns: DataTableColumn<T>[];
  data: T[];
  /** Enable client-side sorting. Column-level `sortable` defaults to true when this is set. */
  sortable?: boolean;
  /** Enable column filter inputs. Column-level `filterable` defaults to true when this is set. */
  filterable?: boolean;
  /** Controlled sort state. Use with `onSortChange` for server-side sorting. */
  sort?: SortState | null;
  /** Called when sort changes. If not provided, sorting is handled client-side. */
  onSortChange?: (sort: SortState | null) => void;
  /** Called when any column filter changes. Keys are column keys, values are filter strings. */
  onFilterChange?: (filters: Record<string, string>) => void;
  styles?: {
    root?: React.CSSProperties;
    table?: React.CSSProperties;
    header?: React.CSSProperties;
    row?: React.CSSProperties;
    cell?: React.CSSProperties;
  };
}

/* ── Sort carets ── */

function SortIndicator({ direction, active }: { direction?: SortDirection; active: boolean }) {
  return (
    <span className="inline-flex flex-col items-center ml-1.5 leading-none gap-px">
      <svg
        width="8"
        height="5"
        viewBox="0 0 8 5"
        className={cn(
          'transition-colors',
          active && direction === 'asc' ? 'text-foreground' : 'text-muted-foreground/30',
        )}
      >
        <path d="M4 0L7.46 4.5H0.54L4 0Z" fill="currentColor" />
      </svg>
      <svg
        width="8"
        height="5"
        viewBox="0 0 8 5"
        className={cn(
          'transition-colors',
          active && direction === 'desc' ? 'text-foreground' : 'text-muted-foreground/30',
        )}
      >
        <path d="M4 5L0.54 0.5H7.46L4 5Z" fill="currentColor" />
      </svg>
    </span>
  );
}

/* ── Filter icon + popover ── */

function FilterPopover({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const hasValue = value.length > 0;

  return (
    <span ref={ref} className="relative inline-flex">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(!open);
        }}
        className={cn(
          'ml-1 p-0.5 rounded transition-colors hover:text-foreground cursor-pointer',
          hasValue ? 'text-foreground' : 'text-muted-foreground/40',
        )}
        aria-label="Filter column"
      >
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
          <path
            d="M1.5 2h13l-5 6v4.5l-3 1.5V8L1.5 2z"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {open && (
        <div
          className="absolute top-full left-0 mt-1 z-50 bg-white border border-border rounded-md shadow-md p-1.5"
          onClick={(e) => e.stopPropagation()}
        >
          <input
            type="text"
            autoFocus
            placeholder="Filter..."
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className={cn(
              'w-36 px-2 py-1 text-xs font-normal rounded border border-border bg-white',
              'focus:outline-none focus:ring-1 focus:ring-ring',
              'placeholder:text-muted-foreground/50',
            )}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setOpen(false);
            }}
          />
        </div>
      )}
    </span>
  );
}

/* ── Main component ── */

export function DataTable<T extends Record<string, unknown>>({
  columns,
  data,
  sortable = false,
  filterable = false,
  sort: controlledSort,
  onSortChange,
  onFilterChange,
  className,
  styles,
  ...props
}: DataTableProps<T>) {
  const [internalSort, setInternalSort] = useState<SortState | null>(null);
  const [filters, setFilters] = useState<Record<string, string>>({});

  const currentSort = controlledSort !== undefined ? controlledSort : internalSort;
  const isControlledSort = onSortChange !== undefined;

  const handleSort = useCallback(
    (key: string) => {
      const newSort: SortState | null =
        currentSort?.key === key
          ? currentSort.direction === 'asc'
            ? { key, direction: 'desc' }
            : null
          : { key, direction: 'asc' };

      if (isControlledSort) {
        onSortChange!(newSort);
      } else {
        setInternalSort(newSort);
      }
    },
    [currentSort, isControlledSort, onSortChange],
  );

  const handleFilterChange = useCallback(
    (key: string, value: string) => {
      const next = { ...filters, [key]: value };
      if (!value) delete next[key];
      setFilters(next);
      onFilterChange?.(next);
    },
    [filters, onFilterChange],
  );

  // Client-side filtering
  const filteredData = useMemo(() => {
    if (onFilterChange || Object.keys(filters).length === 0) return data;
    return data.filter((row) =>
      Object.entries(filters).every(([key, filterVal]) => {
        const cellVal = row[key];
        if (cellVal == null) return false;
        return String(cellVal).toLowerCase().includes(filterVal.toLowerCase());
      }),
    );
  }, [data, filters, onFilterChange]);

  // Client-side sorting
  const sortedData = useMemo(() => {
    if (isControlledSort || !currentSort) return filteredData;
    const { key, direction } = currentSort;
    return [...filteredData].sort((a, b) => {
      const aVal = a[key];
      const bVal = b[key];
      if (aVal == null && bVal == null) return 0;
      if (aVal == null) return 1;
      if (bVal == null) return -1;
      const cmp =
        typeof aVal === 'number' && typeof bVal === 'number'
          ? aVal - bVal
          : String(aVal).localeCompare(String(bVal));
      return direction === 'asc' ? cmp : -cmp;
    });
  }, [filteredData, currentSort, isControlledSort]);

  return (
    <div
      className={cn(
        'w-full max-w-full overflow-x-auto overflow-y-visible bg-card border border-border rounded-lg',
        className,
      )}
      style={styles?.root}
      {...props}
    >
      <table className="w-full min-w-max" style={styles?.table}>
        <thead>
          <tr className="border-b border-border bg-gray-50">
            {columns.map((col) => {
              const isSortable = sortable && col.sortable !== false;
              const isFilterable = filterable && col.filterable !== false;
              const isActive = currentSort?.key === col.key;
              return (
                <th
                  key={col.key}
                  className={cn(
                    'px-4 py-3 text-xs font-semibold tracking-normal text-muted-foreground',
                    col.align === 'right' && 'text-right',
                    col.align === 'center' && 'text-center',
                    isSortable && 'cursor-pointer select-none hover:text-foreground transition-colors',
                  )}
                  style={styles?.header}
                  onClick={isSortable ? () => handleSort(col.key) : undefined}
                >
                  <span className="inline-flex items-center">
                    {col.header}
                    {isSortable && (
                      <SortIndicator
                        direction={isActive ? currentSort!.direction : undefined}
                        active={isActive}
                      />
                    )}
                    {isFilterable && (
                      <FilterPopover
                        value={filters[col.key] ?? ''}
                        onChange={(v) => handleFilterChange(col.key, v)}
                      />
                    )}
                  </span>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sortedData.map((row, i) => (
            <tr
              key={i}
              className="border-b border-border last:border-b-0 hover:bg-gray-50"
              style={styles?.row}
            >
              {columns.map((col) => (
                <td
                  key={col.key}
                  className={cn(
                    'px-4 py-3 text-sm text-foreground',
                    col.align === 'right' && 'text-right',
                    col.align === 'center' && 'text-center',
                  )}
                  style={styles?.cell}
                >
                  {col.format
                    ? col.format(row[col.key], row)
                    : String(row[col.key] ?? '')}
                </td>
              ))}
            </tr>
          ))}
          {sortedData.length === 0 && (
            <tr>
              <td
                colSpan={columns.length}
                className="px-4 py-8 text-center text-sm text-muted-foreground"
              >
                No data
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
