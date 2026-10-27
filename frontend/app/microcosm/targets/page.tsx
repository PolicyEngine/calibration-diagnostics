import { AppShell } from "@/components/layout/app-shell";
import { CountryNotConfiguredState } from "@/components/microcosm/country-not-configured";
import { MicrocosmTargetsView } from "@/components/microcosm/microcosm-targets-view";
import { publishedReleaseSelection } from "@/lib/microcosm/calibration-selection";
import { countryParam } from "@policyengine/calibration-tree/countries";

interface MicrocosmTargetsPageProps {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

export default async function MicrocosmTargetsPage({
  searchParams,
}: MicrocosmTargetsPageProps) {
  const params = await searchParams;
  const rawScope = Array.isArray(params?.scope) ? params.scope[0] : params?.scope;
  const initialScope = rawScope === "healthcare" ? "healthcare" : "all";
  const rawSource = Array.isArray(params?.source) ? params.source[0] : params?.source;
  const rawLevel = Array.isArray(params?.level) ? params.level[0] : params?.level;
  const rawRelease = Array.isArray(params?.release) ? params.release[0] : params?.release;
  const rawStart = Array.isArray(params?.start) ? params.start[0] : params?.start;
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
      <MicrocosmTargetsView
        initialScope={initialScope}
        initialSource={rawSource ?? ""}
        initialLevel={rawLevel ?? ""}
        initialCountry={country.country}
        initialRelease={publishedReleaseSelection(rawRelease)}
        initialStep={rawStart === "explore" ? "pick" : "results"}
      />
    </AppShell>
  );
}
