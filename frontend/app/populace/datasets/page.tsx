import { Suspense } from "react";

import { AppShell } from "@/components/layout/app-shell";
import { CrossDatasetView } from "@/components/populace/cross-dataset-view";
import { LoadingBlock } from "@/components/shared/LoadingBlock";

export default function CrossDatasetPage() {
  return (
    <AppShell>
      <Suspense fallback={<LoadingBlock label="Loading Cross-dataset view…" />}>
        <CrossDatasetView />
      </Suspense>
    </AppShell>
  );
}
