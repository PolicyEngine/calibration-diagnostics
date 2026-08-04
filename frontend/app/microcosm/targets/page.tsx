import { AppShell } from "@/components/layout/app-shell";
import { MicrocosmTargetsView } from "@/components/microcosm/microcosm-targets-view";
import { parseExplorerSearch } from "@/lib/microcosm/calibration-explorer";

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
  const explorerParams = new URLSearchParams();
  for (const [key, rawValue] of Object.entries(params ?? {})) {
    for (const value of Array.isArray(rawValue) ? rawValue : [rawValue]) {
      if (value != null) explorerParams.append(key, value);
    }
  }
  const initialExplorerState = parseExplorerSearch(explorerParams);
  const hasExplorerProgram = Boolean(
    initialExplorerState.path.source && initialExplorerState.path.program,
  );

  return (
    <AppShell>
      <MicrocosmTargetsView
        initialScope={initialScope}
        initialSource={hasExplorerProgram ? "" : rawSource ?? ""}
        initialLevel={rawLevel ?? ""}
        initialRelease={rawRelease ?? ""}
        initialExplorerState={initialExplorerState}
      />
    </AppShell>
  );
}
