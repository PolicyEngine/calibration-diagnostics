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
  const rawSource = Array.isArray(params?.source) ? params.source[0] : params?.source;
  const rawLevel = Array.isArray(params?.level) ? params.level[0] : params?.level;

  return (
    <AppShell>
      <PopulaceTargetsView
        initialScope={initialScope}
        initialSource={rawSource ?? ""}
        initialLevel={rawLevel ?? ""}
      />
    </AppShell>
  );
}
