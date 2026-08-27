import { AppShell } from "@/components/layout/app-shell";
import { MicrocosmOverviewView } from "@/components/microcosm/microcosm-overview-view";

interface MicrocosmOverviewPageProps {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

export default async function MicrocosmOverviewPage({
  searchParams,
}: MicrocosmOverviewPageProps) {
  const params = await searchParams;
  const rawRelease = Array.isArray(params?.release) ? params.release[0] : params?.release;

  return (
    <AppShell>
      <MicrocosmOverviewView initialRelease={rawRelease ?? ""} />
    </AppShell>
  );
}
