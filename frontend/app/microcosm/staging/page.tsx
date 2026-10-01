import { Suspense } from "react";

import { AppShell } from "@/components/layout/app-shell";
import { MicrocosmStagingView } from "@/components/microcosm/microcosm-staging-view";
import { LoadingBlock } from "@/components/shared/LoadingBlock";

export default function MicrocosmStagingPage() {
  return (
    <AppShell>
      <Suspense fallback={<LoadingBlock label="Loading staging candidates…" />}>
        <MicrocosmStagingView />
      </Suspense>
    </AppShell>
  );
}
