import { AppShell } from "@/components/layout/app-shell";
import { CountryNotConfiguredState } from "@/components/microcosm/country-not-configured";
import { MicrocosmOverviewView } from "@/components/microcosm/microcosm-overview-view";
import { publishedReleaseSelection } from "@/lib/microcosm/calibration-selection";
import { countryParam } from "@policyengine/calibration-tree/countries";

interface MicrocosmOverviewPageProps {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

export default async function MicrocosmOverviewPage({
  searchParams,
}: MicrocosmOverviewPageProps) {
  const params = await searchParams;
  const rawRelease = Array.isArray(params?.release) ? params.release[0] : params?.release;
  const rawCountry = Array.isArray(params?.country) ? params.country[0] : params?.country;
  const country = countryParam(rawCountry);
  if (!country.configured) {
    return (
      <AppShell>
        <CountryNotConfiguredState requested={country.requested} />
      </AppShell>
    );
  }

  return (
    <AppShell>
      <MicrocosmOverviewView
        initialCountry={country.country}
        initialRelease={publishedReleaseSelection(rawRelease)}
      />
    </AppShell>
  );
}
