import { AppShell } from "@/components/layout/app-shell";
import { MicrocosmTargetsView } from "@/components/microcosm/microcosm-targets-view";

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

  return (
    <AppShell>
      <MicrocosmTargetsView
        initialScope={initialScope}
        initialSource={rawSource ?? ""}
        initialLevel={rawLevel ?? ""}
      />
    </AppShell>
  );
}
