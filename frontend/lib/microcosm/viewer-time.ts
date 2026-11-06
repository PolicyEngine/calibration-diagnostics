// Times on the Staging page are shown in the viewer's own time zone, the one
// their browser reports, and the page names that zone. Every function here
// takes the zone, so the page and its tests choose it. `null` stands for the
// runtime's default zone and locale, as on the server before the page knows
// the browser's zone.
//
// A date and a time are formatted separately and joined with ", ", as in
// "Nov 3, 03:17 PM": runtimes with different versions of the Unicode locale
// data join a combined date and time differently ("Nov 3 at 03:17 PM").

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

function format(
  ms: number,
  zone: ViewerZone | null,
  options: Intl.DateTimeFormatOptions,
): string {
  return new Date(ms).toLocaleString(zone?.locale, {
    ...options,
    timeZone: zone?.timeZone,
  });
}

// The zone's short name at that moment, such as "GMT+4", "EST" or "UTC".
export function zoneAbbreviation(ms: number, zone: ViewerZone): string {
  const parts = new Intl.DateTimeFormat(zone.locale, {
    timeZone: zone.timeZone,
    timeZoneName: "short",
  }).formatToParts(new Date(ms));
  return parts.find((part) => part.type === "timeZoneName")?.value ?? zone.timeZone;
}

function withZoneName(
  text: string,
  ms: number,
  zone: ViewerZone | null,
  options: ZoneNameOption,
): string {
  return options.zoneName && zone ? `${text} ${zoneAbbreviation(ms, zone)}` : text;
}

function sameDay(first: number, second: number, zone: ViewerZone | null): boolean {
  const day: Intl.DateTimeFormatOptions = { year: "numeric", month: "numeric", day: "numeric" };
  return format(first, zone, day) === format(second, zone, day);
}

// A time on the build monitor's run overview: "07:56 AM" on the viewer's
// today, "Nov 3, 03:17 PM" on another day, and "—" when unknown.
export function clockTime(
  ms: number | null | undefined,
  nowMs: number,
  zone: ViewerZone | null,
  options: ZoneNameOption = {},
): string {
  if (ms == null || !Number.isFinite(ms)) return "—";
  const time = format(ms, zone, { hour: "2-digit", minute: "2-digit" });
  const text = sameDay(ms, nowMs, zone)
    ? time
    : `${format(ms, zone, { month: "short", day: "numeric" })}, ${time}`;
  return withZoneName(text, ms, zone, options);
}

// A run's start in the build monitor's run selector, "Nov 3, 3:17 PM", and in
// its run history, "Tue, Nov 3, 3:17 PM" with the weekday.
export function runStartTime(
  ms: number,
  zone: ViewerZone | null,
  options: ZoneNameOption & { weekday?: boolean } = {},
): string {
  const date = format(ms, zone, {
    ...(options.weekday ? { weekday: "short" } : {}),
    month: "short",
    day: "numeric",
  });
  const time = format(ms, zone, { hour: "numeric", minute: "2-digit" });
  return withZoneName(`${date}, ${time}`, ms, zone, options);
}

// The Candidate tab's date and time, "Nov 3, 03:17 PM". An empty value shows
// "—" and an unparseable one is shown as given.
export function shortDateTime(
  value: string | null | undefined,
  zone: ViewerZone | null,
  options: ZoneNameOption = {},
): string {
  if (!value) return "—";
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return value;
  const date = format(ms, zone, { month: "short", day: "numeric" });
  const time = format(ms, zone, { hour: "2-digit", minute: "2-digit" });
  return withZoneName(`${date}, ${time}`, ms, zone, options);
}

// A time's hover text: the time in full in the viewer's zone, then in UTC,
// the zone run IDs are stamped in: "Tue, Nov 3, 2026, 03:17:33 PM GMT+4 ·
// 2026-11-03 11:17:33 UTC".
export function timeTitle(ms: number, zone: ViewerZone | null): string {
  if (!Number.isFinite(ms)) return "";
  const date = format(ms, zone, {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  const time = format(ms, zone, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short",
  });
  const utc = new Date(ms).toISOString();
  return `${date}, ${time} · ${utc.slice(0, 10)} ${utc.slice(11, 19)} UTC`;
}

// The sentence that names the zone the page's times are in.
export function zoneNote(zone: ViewerZone, nowMs: number): string {
  const abbreviation = zoneAbbreviation(nowMs, zone);
  const name =
    abbreviation === zone.timeZone ? zone.timeZone : `${zone.timeZone} (${abbreviation})`;
  return `Times are in your browser's time zone, ${name}. Hover over a time to see it in UTC, which run IDs use.`;
}
