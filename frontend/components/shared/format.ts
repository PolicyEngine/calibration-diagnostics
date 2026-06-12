import { formatNumber } from "@policyengine/ui-kit";

export function fmt(
  value: number | null | undefined,
  opts: { pct?: boolean; digits?: number } = {},
): string {
  if (value == null || !Number.isFinite(value)) return "—";
  if (opts.pct) {
    const digits = opts.digits ?? 1;
    return `${(value * 100).toFixed(digits)}%`;
  }
  if (Math.abs(value) >= 1000 || Number.isInteger(value)) {
    return formatNumber(value);
  }
  return value.toFixed(opts.digits ?? 4);
}

export function fmtSigned(
  value: number | null | undefined,
  opts: { pct?: boolean; digits?: number } = {},
): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${fmt(value, opts)}`;
}

export function fmtCompact(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1e12) return `${sign}${(abs / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${sign}${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}${(abs / 1e3).toFixed(1)}K`;
  return `${sign}${abs.toFixed(0)}`;
}

export function fmtMoney(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1e12) return `${sign}$${(abs / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

export function fmtSignedMoney(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${fmtMoney(value)}`;
}

export function fmtRatio(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value.toFixed(2)}×`;
}

export function tone(
  value: number | null | undefined,
  improveIsLower = true,
): "positive" | "negative" | "neutral" {
  if (value == null || !Number.isFinite(value) || Math.abs(value) < 1e-9) {
    return "neutral";
  }
  return (improveIsLower ? value < 0 : value > 0) ? "positive" : "negative";
}
