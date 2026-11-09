import { expect, test } from "bun:test";

import {
  clockTime,
  runStartTime,
  shortDateTime,
  timeTitle,
  type ViewerZone,
  zoneNote,
} from "@/lib/microcosm/viewer-time";

// Two zones far enough apart that no single runtime zone formats both as
// expected, so a function that ignores its zone fails wherever it runs.
const LONDON: ViewerZone = { timeZone: "Europe/London", locale: "en-GB" };
const NEW_YORK: ViewerZone = { timeZone: "America/New_York", locale: "en-US" };
const UTC_ZONE: ViewerZone = { timeZone: "UTC", locale: "en-US" };

// The US run populace-us-2024-65671e1-9434c504ba2a-20261103T095117Z started at
// 11:17:33 UTC, a Tuesday.
const NOVEMBER_RUN_START_MS = Date.parse("2026-11-03T11:17:33Z");
// In July New York keeps daylight saving time.
const JULY_RUN_START_MS = Date.parse("2026-07-03T01:25:18Z");
// 00:30 UTC on November 7 is already November 7 in London, but still
// November 6 in New York.
const EVENING_NOW_MS = Date.parse("2026-11-07T00:30:00Z");
const EVENING_RUN_END_MS = Date.parse("2026-11-06T23:30:00Z");

// Some versions of the Unicode locale data put a narrow no-break space
// before "AM" and "PM".
function plain(text: string): string {
  return text.replace(/ /g, " ");
}

test("a run's start reads in the viewer's zone, whatever the runtime's zone", () => {
  expect(plain(runStartTime(NOVEMBER_RUN_START_MS, LONDON))).toBe("3 Nov, 11:17");
  expect(plain(runStartTime(NOVEMBER_RUN_START_MS, NEW_YORK))).toBe("Nov 3, 6:17 AM");
  expect(plain(runStartTime(NOVEMBER_RUN_START_MS, NEW_YORK, { weekday: true }))).toBe(
    "Tue, Nov 3, 6:17 AM",
  );
});

test("a clock time shows its date unless it falls on the viewer's own today", () => {
  expect(plain(clockTime(EVENING_RUN_END_MS, EVENING_NOW_MS, LONDON))).toBe("6 Nov, 23:30");
  expect(plain(clockTime(EVENING_RUN_END_MS, EVENING_NOW_MS, NEW_YORK))).toBe("06:30 PM");
  expect(clockTime(null, EVENING_NOW_MS, LONDON)).toBe("—");
});

test("a time can name the viewer's zone, as it stands on that date", () => {
  expect(plain(clockTime(EVENING_RUN_END_MS, EVENING_NOW_MS, LONDON, { zoneName: true }))).toBe(
    "6 Nov, 23:30 GMT",
  );
  expect(plain(clockTime(JULY_RUN_START_MS, EVENING_NOW_MS, NEW_YORK, { zoneName: true }))).toBe(
    "Jul 2, 09:25 PM EDT",
  );
  expect(plain(runStartTime(NOVEMBER_RUN_START_MS, NEW_YORK, { zoneName: true }))).toBe(
    "Nov 3, 6:17 AM EST",
  );
});

test("a time's hover text gives it in full in the viewer's zone and in UTC", () => {
  expect(plain(timeTitle(NOVEMBER_RUN_START_MS, LONDON))).toBe(
    "Tue, 3 Nov 2026, 11:17:33 GMT · 2026-11-03 11:17:33 UTC",
  );
  expect(plain(timeTitle(JULY_RUN_START_MS, NEW_YORK))).toBe(
    "Thu, Jul 2, 2026, 09:25:18 PM EDT · 2026-07-03 01:25:18 UTC",
  );
});

test("the zone note names the browser's zone and its current short name", () => {
  expect(zoneNote(LONDON, NOVEMBER_RUN_START_MS)).toBe(
    "Times are in your browser's time zone, Europe/London (GMT). Hover over a time to see it in UTC, which run IDs use.",
  );
  expect(zoneNote(UTC_ZONE, NOVEMBER_RUN_START_MS)).toBe(
    "Times are in your browser's time zone, UTC. Hover over a time to see it in UTC, which run IDs use.",
  );
});

test("the Candidate tab's times read in the viewer's zone", () => {
  expect(plain(shortDateTime("2026-11-03T11:17:33+00:00", LONDON))).toBe("3 Nov, 11:17");
  expect(plain(shortDateTime("2026-11-03T11:17:33Z", NEW_YORK, { zoneName: true }))).toBe(
    "Nov 3, 06:17 AM EST",
  );
  expect(shortDateTime(null, LONDON)).toBe("—");
  expect(shortDateTime("not a time", LONDON)).toBe("not a time");
});
