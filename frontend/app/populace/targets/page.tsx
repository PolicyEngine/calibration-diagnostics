import { AppShell } from "@/components/layout/app-shell";
import { PopulaceTargetsView } from "@/components/populace/populace-targets-view";

interface PopulaceTargetsPageProps {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

export default async function PopulaceTargetsPage({
  searchParams,
}: PopulaceTargetsPageProps) {
  const params = await searchParams;
  const rawScope = Array.isArray(params?.scope) ? params.scope[0] : params?.scope;
  const initialScope = rawScope === "healthcare" ? "healthcare" : "all";

  return (
    <AppShell>
      <PopulaceTargetsView initialScope={initialScope} />
    </AppShell>
  );
}
