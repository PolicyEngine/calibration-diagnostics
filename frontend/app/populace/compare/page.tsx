import { AppShell } from "@/components/layout/app-shell";
import { PopulaceCompareView } from "@/components/populace/populace-compare-view";

interface PopulaceComparePageProps {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

export default async function PopulaceComparePage({
  searchParams,
}: PopulaceComparePageProps) {
  const params = await searchParams;
  const rawScope = Array.isArray(params?.scope) ? params.scope[0] : params?.scope;
  const rawA = Array.isArray(params?.a) ? params.a[0] : params?.a;
  const rawB = Array.isArray(params?.b) ? params.b[0] : params?.b;

  return (
    <AppShell>
      <PopulaceCompareView
        initialA={rawA ?? ""}
        initialB={rawB ?? ""}
        initialScope={rawScope === "healthcare" ? "healthcare" : "all"}
      />
    </AppShell>
  );
}
