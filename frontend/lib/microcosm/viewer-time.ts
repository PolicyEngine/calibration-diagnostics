// Times on the Staging page. Each function formats as the page does today:
// in the runtime's default zone, whatever zone it is given, without naming
// the zone.

export interface ViewerZone {
  // An IANA time zone name, such as "Asia/Baku".
  timeZone: string;
  // A BCP 47 locale tag; the runtime's default locale when absent.
  locale?: string;
}

export interface ZoneNameOption {
  // Follow the time with the zone's short name, as in "03:17 PM GMT+4".
  zoneName?: boolean;
}

// The browser's own time zone.
export function browserZone(): ViewerZone {
  return { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone };
}

export function zoneAbbreviation(_ms: number, _zone: ViewerZone): string {
  return "";
}

export function clockTime(
  ms: number | null | undefined,
  nowMs: number,
  _zone: ViewerZone | null,
  _options: ZoneNameOption = {},
): string {
  if (ms == null || !Number.isFinite(ms)) return "—";
  const date = new Date(ms);
  const sameDay = new Date(nowMs).toDateString() === date.toDateString();
  const time = date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  if (sameDay) return time;
  return `${date.toLocaleDateString(undefined, { month: "short", day: "numeric" })}, ${time}`;
}

export function runStartTime(
  ms: number,
  _zone: ViewerZone | null,
  options: ZoneNameOption & { weekday?: boolean } = {},
): string {
  return new Date(ms).toLocaleString(undefined, {
    ...(options.weekday ? { weekday: "short" } : {}),
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function shortDateTime(
  value: string | null | undefined,
  _zone: ViewerZone | null,
  _options: ZoneNameOption = {},
): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function timeTitle(_ms: number, _zone: ViewerZone | null): string {
  return "";
}

export function zoneNote(_zone: ViewerZone, _nowMs: number): string {
  return "";
}
