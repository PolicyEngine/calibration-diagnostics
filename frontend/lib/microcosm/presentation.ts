import type { MicrocosmCountry } from "./countries";

export interface MicrocosmPresentationSlots {
  overview_intro?: string;
  targets_intro?: string;
}

// Legacy copy for releases published before `release_manifest.presentation`;
// delete once US/UK/BE publish the block.
const LEGACY_OVERVIEW_COPY: Partial<
  Record<MicrocosmCountry, { authorities: string }>
> = {
  us: {
    authorities: "the IRS, the Census Bureau, and CMS",
  },
  uk: {
    authorities: "the ONS, OBR, and HMRC",
  },
  be: {
    authorities: "Statbel, ONSS, JRC, and SFPD",
  },
};

const GENERIC_OVERVIEW_INTRO =
  "Microcosm reweights survey microdata so it matches official statistics from national statistical agencies and administrative sources. Each of these official statistics is a calibration target, grouped by category in the calibration fit explorer below.";

// Legacy copy for releases published before `release_manifest.presentation`;
// delete once US/UK/BE publish the block.
const LEGACY_TARGETS_COPY: Partial<Record<MicrocosmCountry, string>> = {
  us:
    "Pick a measure like EITC, population, or AGI and see how each breakdown is calibrated.",
  uk:
    "Pick a measure like population, household type, or tax receipts and see how each breakdown is calibrated.",
  be:
    "Pick a measure like population, income tax, or pension recipients and see how each breakdown is calibrated.",
};

const GENERIC_TARGETS_INTRO =
  "Pick a measure and see how each breakdown is calibrated.";

export function microcosmOverviewIntro(
  country: MicrocosmCountry,
  presentation?: MicrocosmPresentationSlots | null,
): string {
  if (presentation?.overview_intro) return presentation.overview_intro;
  const legacy = LEGACY_OVERVIEW_COPY[country];
  return legacy
    ? `Microcosm reweights survey microdata so it matches official statistics from agencies like ${legacy.authorities}. Each of these official statistics is a calibration target, grouped by category in the calibration fit explorer below.`
    : GENERIC_OVERVIEW_INTRO;
}

export function microcosmTargetsIntro(
  country: MicrocosmCountry,
  presentation?: MicrocosmPresentationSlots | null,
): string {
  return presentation?.targets_intro ??
    LEGACY_TARGETS_COPY[country] ??
    GENERIC_TARGETS_INTRO;
}
