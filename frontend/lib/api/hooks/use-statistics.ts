import { useQuery } from "@tanstack/react-query";
import { apiGet } from "../client";
import { statisticsKeys } from "../query-keys";
import type { PovertyRate, IncomeDistribution } from "../types";

interface GeoParams {
  stateFips?: number;
  cdGeoid?: number;
  geoLevel?: string;
}

export function usePovertyRate(params: GeoParams = {}) {
  return useQuery({
    queryKey: [...statisticsKeys.povertyRate(), params],
    queryFn: () =>
      apiGet<PovertyRate>("/statistics/poverty-rate", {
        state_fips: params.stateFips,
        cd_geoid: params.cdGeoid,
      }),
  });
}

export function useMedianAgi(params: GeoParams = {}) {
  return useQuery({
    queryKey: ["statistics", "median-agi", params],
    queryFn: () =>
      apiGet<{ median_agi: number }>("/statistics/median-agi", {
        state_fips: params.stateFips,
        cd_geoid: params.cdGeoid,
      }),
  });
}

interface CalibrationFitParams {
  geoLevel?: string;
  stateFips?: number;
}

export interface CalibrationFit {
  total_targets: number;
  excellent: number;
  good: number;
  needs_work: number;
  excellent_pct: number;
  good_pct: number;
  needs_work_pct: number;
  avg_rel_error: number;
  weighted_score: number;
}

export function useCalibrationFit(params: CalibrationFitParams = {}) {
  return useQuery({
    queryKey: ["statistics", "calibration-fit", params],
    queryFn: () =>
      apiGet<CalibrationFit>("/statistics/calibration-fit", {
        geo_level: params.geoLevel,
        state_fips: params.stateFips,
      }),
  });
}

export function useIncomeDistribution(params: GeoParams = {}) {
  return useQuery({
    queryKey: [...statisticsKeys.incomeDistribution(), params],
    queryFn: () =>
      apiGet<IncomeDistribution>("/statistics/income-distribution", {
        state_fips: params.stateFips,
        cd_geoid: params.cdGeoid,
      }),
  });
}
