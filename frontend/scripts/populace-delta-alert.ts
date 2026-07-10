#!/usr/bin/env bun
// Release-delta alert. Given two release ids (default: latest vs the previous
// registry release), computes the headline delta table and posts it to the
// populace Slack webhook. No-ops with a clear log line when the webhook env var
// is unset, so it is safe to run anywhere (cron, CI, locally).
//
//   bun run scripts/populace-delta-alert.ts                 # latest vs previous
//   bun run scripts/populace-delta-alert.ts --a <id> --b <id>
//   bun run scripts/populace-delta-alert.ts --country us --dry-run
//
// Env: SLACK_WEBHOOK_POPULACE_US / _UK (the same vars the populace publish CLI
// uses). Unset → printed only, never posted.

import { parseCountry, type PopulaceCountry } from "@/lib/populace/latest-artifact";
import {
  formatDeltaTable,
  loadLatestDelta,
  loadReleaseDelta,
  type DeltaReport,
} from "@/lib/populace/deltas";
import { postDeltaAlert } from "@/lib/slack";

interface Args {
  a?: string;
  b?: string;
  country: PopulaceCountry;
  dryRun: boolean;
  failOnFlags: boolean;
  quietWhenClean: boolean;
  help: boolean;
}

function parseArgv(argv: string[]): Args {
  const args: Args = {
    country: "us",
    dryRun: false,
    failOnFlags: false,
    quietWhenClean: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--a") args.a = argv[++i];
    else if (arg === "--b") args.b = argv[++i];
    else if (arg === "--country") args.country = parseCountry(argv[++i]);
    else if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--fail-on-flags") args.failOnFlags = true;
    else if (arg === "--quiet-when-clean") args.quietWhenClean = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
  }
  return args;
}

const HELP = `populace-delta-alert — post the release delta table to Slack.

Options:
  --a <release-id>   Earlier release (default: previous registry release)
  --b <release-id>   Later release  (default: latest via latest.json)
  --country <us|uk>  Dataset (default: us)
  --dry-run          Compute and print, never post to Slack
  --fail-on-flags    Exit 2 when any metric moved beyond its band
  --quiet-when-clean Skip posting to Slack when nothing moved beyond band
  --help             Show this help

Env: SLACK_WEBHOOK_POPULACE_US / SLACK_WEBHOOK_POPULACE_UK (unset → printed only).`;

async function main(): Promise<number> {
  const args = parseArgv(process.argv.slice(2));
  if (args.help) {
    console.log(HELP);
    return 0;
  }

  let report: DeltaReport;
  if (args.a && args.b) {
    report = await loadReleaseDelta(args.a, args.b, 0, args.country);
  } else {
    const latest = await loadLatestDelta(0, args.country);
    if (!latest.available) {
      console.log(`No delta to report: ${latest.reason}`);
      return 0;
    }
    report = latest;
  }

  console.log(`\nPopulace ${args.country.toUpperCase()} release delta`);
  console.log(`  previous: ${report.a_release}`);
  console.log(`  latest:   ${report.b_release}\n`);
  console.log(formatDeltaTable(report));
  console.log("");

  const envVar = args.country === "uk" ? "SLACK_WEBHOOK_POPULACE_UK" : "SLACK_WEBHOOK_POPULACE_US";
  if (args.quietWhenClean && report.flags.length === 0) {
    console.log("No beyond-band moves since the previous release — not posting (--quiet-when-clean).");
  } else if (args.dryRun) {
    console.log(`[dry-run] not posting to Slack (${envVar}).`);
  } else if (!process.env[envVar]) {
    console.log(`${envVar} is unset — printed only, nothing posted.`);
  } else {
    const posted = await postDeltaAlert({ country: args.country, report });
    console.log(posted ? `Posted to Slack (${envVar}).` : `${envVar} unset — nothing posted.`);
  }

  if (args.failOnFlags && report.flags.length > 0) {
    console.error(`\n${report.flags.length} beyond-band flag(s) — exiting non-zero (--fail-on-flags).`);
    return 2;
  }
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error("Delta alert failed:", error instanceof Error ? error.message : error);
    process.exit(1);
  });
