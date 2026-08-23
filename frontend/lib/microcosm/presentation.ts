import type { MicrocosmCountry } from "./countries";

export interface MicrocosmPresentationSlots {
  overview_intro?: string;
  targets_intro?: string;
}

// Legacy copy for releases published before `release_manifest.presentation`;
// delete once US/UK/BE publish the block.
const LEGACY_OVERVIEW_COPY: Partial<
  Record<MicrocosmCountry, { authorities: string; examples: string }>
> = {
  us: {
    authorities: "the IRS, the Census Bureau, and CMS",
    examples: "EITC statistics, population, and Medicaid enrollment",
  },
  uk: {
    authorities: "the ONS, OBR, and HMRC",
    examples: "population by region and age, household types, and tax receipts",
  },
  be: {
    authorities: "Statbel, ONSS, JRC, and SFPD",
    examples: "population by region, sex, and age band, tax receipts, and benefit totals",
  },
};

const GENERIC_OVERVIEW_INTRO =
  "Microcosm reweights survey microdata so it matches official statistics from national statistical agencies and administrative sources. Each tile in the Calibration fit explorer below is a category we calibrate to.";

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
    ? `Microcosm reweights survey microdata so it matches official statistics from agencies like ${legacy.authorities}. Each tile in the Calibration fit explorer below is a category we calibrate to, including ${legacy.examples}.`
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
