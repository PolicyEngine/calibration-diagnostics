import { AppShell } from "@/components/layout/app-shell";
import { MicrocosmOverviewView } from "@/components/microcosm/microcosm-overview-view";
import { parseCountry } from "@/lib/microcosm/countries";

interface MicrocosmOverviewPageProps {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

export default async function MicrocosmOverviewPage({
  searchParams,
}: MicrocosmOverviewPageProps) {
  const params = await searchParams;
  const rawRelease = Array.isArray(params?.release) ? params.release[0] : params?.release;
  const rawCountry = Array.isArray(params?.country) ? params.country[0] : params?.country;

  return (
    <AppShell>
      <MicrocosmOverviewView
        initialCountry={parseCountry(rawCountry)}
        initialRelease={rawRelease ?? ""}
      />
    </AppShell>
  );
}
