import { EmptyState } from "@/components/shared/empty-state";
import {
  countryRegistration,
  isCountry,
  type CountryNotConfiguredReason,
} from "@policyengine/calibration-tree/countries";

const MAX_CODE_LENGTH = 32;

function displayCode(requested: string): string {
  return requested.length > MAX_CODE_LENGTH
    ? `${requested.slice(0, MAX_CODE_LENGTH)}…`
    : requested;
}

// The honest state for a country with no configured release: an explicit
// empty state naming what was requested, never another country's release.
export function CountryNotConfiguredState({
  requested,
  reason,
}: {
  requested: string;
  reason?: CountryNotConfiguredReason;
}) {
  // A registered country the publisher has not released yet.
  const label =
    reason === "no_published_release" && isCountry(requested)
      ? countryRegistration(requested).label
      : null;
  return (
    <div className="pt-6">
      <EmptyState
        title={
          label
            ? `No published release for ${label} yet`
            : `No Microcosm release for “${displayCode(requested)}”`
        }
        description={
          label
            ? `${label} is registered on this dashboard, but no calibration release has been published for it. Choose another country from the Dataset selector.`
            : `This dashboard has no calibration release configured for the country code “${displayCode(requested)}”. Choose a country from the Dataset selector.`
        }
      />
    </div>
  );
}
