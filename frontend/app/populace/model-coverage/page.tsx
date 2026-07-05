import { AppShell } from "@/components/layout/app-shell";
import { ModelCoverageView } from "@/components/populace/model-coverage-view";

interface ModelCoveragePageProps {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

export default async function ModelCoveragePage({ searchParams }: ModelCoveragePageProps) {
  const params = await searchParams;
  const rawPath = Array.isArray(params?.path) ? params.path[0] : params?.path;
  return (
    <AppShell>
      <ModelCoverageView initialPath={rawPath ?? ""} />
    </AppShell>
  );
}
