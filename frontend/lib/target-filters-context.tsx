"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

export type ErrorBucket = "excellent" | "good" | "poor" | "extreme";
export const ERROR_BUCKETS: ErrorBucket[] = ["excellent", "good", "poor", "extreme"];

export const ERROR_BUCKET_LABELS: Record<ErrorBucket, string> = {
  excellent: "Excellent (<5%)",
  good: "Good (5–20%)",
  poor: "Poor (20–50%)",
  extreme: "Extreme (≥50%)",
};

export type SortKey = "loss_contribution" | "abs_rel_error" | "rel_error" | "variable";
export type SortOrder = "asc" | "desc";
export type StatusFilter = "included" | "all" | "skipped";

export const STATUS_LABELS: Record<StatusFilter, string> = {
  included: "Used",
  all: "All",
  skipped: "Unused",
};

export const GEO_LEVELS = ["national", "state", "district"] as const;
export type GeoLevel = (typeof GEO_LEVELS)[number];

export const GEO_LEVEL_LABELS: Record<GeoLevel, string> = {
  national: "National",
  state: "State",
  district: "District",
};

export interface TargetFilters {
  search: string;
  variables: string[];
  geoLevels: GeoLevel[];
  errorBuckets: ErrorBucket[];
  stateFipsList: number[];        // narrow state-/district-level targets to one or more states
  status: StatusFilter;
  sortBy: SortKey;
  sortOrder: SortOrder;
  page: number;                   // zero-indexed
  pageSize: number;
}

export const DEFAULT_FILTERS: TargetFilters = {
  search: "",
  variables: [],
  geoLevels: [],
  errorBuckets: [],
  stateFipsList: [],
  status: "all",
  sortBy: "abs_rel_error",
  sortOrder: "desc",
  page: 0,
  pageSize: 50,
};

/** Convert tri-state status into the backend's included_only param. */
export function statusToIncludedOnly(s: StatusFilter): boolean | undefined {
  if (s === "included") return true;
  if (s === "skipped") return false;
  return undefined; // "all"
}

interface CtxValue {
  filters: TargetFilters;
  setFilters: (f: Partial<TargetFilters>) => void;
  toggleVariable: (v: string) => void;
  toggleGeoLevel: (g: string) => void;
  toggleErrorBucket: (b: ErrorBucket) => void;
  toggleStateFips: (fips: number) => void;
  clearAll: () => void;
  hasActiveFilters: boolean;
}

const Ctx = createContext<CtxValue | null>(null);

function parseFiltersFromUrl(sp: URLSearchParams): TargetFilters {
  const arr = (k: string) => sp.getAll(k).filter(Boolean);
  const rawStatus = sp.get("status");
  const status: StatusFilter =
    rawStatus === "included" || rawStatus === "skipped" ? rawStatus : "all";
  const stateFipsList = arr("state_fips")
    .map((x) => Number(x))
    .filter((n) => Number.isFinite(n));
  return {
    search: sp.get("search") ?? "",
    variables: arr("variable"),
    geoLevels: arr("geo_level").filter(
      (x): x is GeoLevel => (GEO_LEVELS as readonly string[]).includes(x),
    ),
    errorBuckets: arr("error_bucket").filter(
      (x): x is ErrorBucket => (ERROR_BUCKETS as string[]).includes(x),
    ),
    stateFipsList,
    status,
    sortBy: (sp.get("sort_by") as SortKey) ?? "loss_contribution",
    sortOrder: (sp.get("sort_order") as SortOrder) ?? "desc",
    page: Number(sp.get("page") ?? 0),
    pageSize: Number(sp.get("page_size") ?? 50),
  };
}

function writeFiltersToUrl(
  base: URLSearchParams,
  f: TargetFilters,
): URLSearchParams {
  const next = new URLSearchParams(base.toString());
  // Clear our own keys, keep others (dataset/run/etc.)
  ["search", "variable", "geo_level", "error_bucket", "status", "state_fips",
   "included_only", "sort_by", "sort_order", "page", "page_size"]
    .forEach((k) => next.delete(k));

  if (f.search) next.set("search", f.search);
  f.variables.forEach((v) => next.append("variable", v));
  f.geoLevels.forEach((g) => next.append("geo_level", g));
  f.errorBuckets.forEach((b) => next.append("error_bucket", b));
  f.stateFipsList.forEach((fips) => next.append("state_fips", String(fips)));
  if (f.status !== "all") next.set("status", f.status);
  if (f.sortBy !== "loss_contribution") next.set("sort_by", f.sortBy);
  if (f.sortOrder !== "desc") next.set("sort_order", f.sortOrder);
  if (f.page > 0) next.set("page", String(f.page));
  if (f.pageSize !== 50) next.set("page_size", String(f.pageSize));
  return next;
}

export function TargetFiltersProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [filters, setFiltersState] = useState<TargetFilters>(() =>
    parseFiltersFromUrl(new URLSearchParams(searchParams.toString())),
  );

  // Sync filter changes back to URL
  useEffect(() => {
    const next = writeFiltersToUrl(searchParams, filters);
    const nextStr = next.toString();
    if (nextStr !== searchParams.toString()) {
      router.replace(`${pathname}?${nextStr}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);

  const setFilters = useCallback((patch: Partial<TargetFilters>) => {
    setFiltersState((prev) => {
      // Any non-paging change resets to page 0.
      const isPagingOnly = Object.keys(patch).every(
        (k) => k === "page" || k === "pageSize",
      );
      return {
        ...prev,
        ...patch,
        page: isPagingOnly ? (patch.page ?? prev.page) : 0,
      };
    });
  }, []);

  const toggle = useCallback(
    <K extends "variables" | "geoLevels" | "errorBuckets">(key: K, value: string) =>
      setFiltersState((prev) => {
        const arr = prev[key] as string[];
        const exists = arr.includes(value);
        const next = exists ? arr.filter((x) => x !== value) : [...arr, value];
        return { ...prev, [key]: next, page: 0 } as TargetFilters;
      }),
    [],
  );

  const toggleStateFips = useCallback(
    (fips: number) =>
      setFiltersState((prev) => {
        const exists = prev.stateFipsList.includes(fips);
        const next = exists
          ? prev.stateFipsList.filter((f) => f !== fips)
          : [...prev.stateFipsList, fips];
        return { ...prev, stateFipsList: next, page: 0 };
      }),
    [],
  );

  const value = useMemo<CtxValue>(
    () => ({
      filters,
      setFilters,
      toggleVariable: (v) => toggle("variables", v),
      toggleGeoLevel: (g) => toggle("geoLevels", g),
      toggleErrorBucket: (b) => toggle("errorBuckets", b),
      toggleStateFips,
      clearAll: () =>
        setFiltersState({ ...DEFAULT_FILTERS, pageSize: filters.pageSize }),
      hasActiveFilters:
        !!filters.search ||
        filters.variables.length > 0 ||
        filters.geoLevels.length > 0 ||
        filters.errorBuckets.length > 0 ||
        filters.stateFipsList.length > 0 ||
        filters.status !== "all",
    }),
    [filters, setFilters, toggle, toggleStateFips],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTargetFilters() {
  const ctx = useContext(Ctx);
  if (!ctx) {
    throw new Error("useTargetFilters must be used inside TargetFiltersProvider");
  }
  return ctx;
}
