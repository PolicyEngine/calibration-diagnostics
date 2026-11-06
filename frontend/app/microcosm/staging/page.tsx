import { Suspense } from "react";

import { AppShell } from "@/components/layout/app-shell";
import { MicrocosmStagingView } from "@/components/microcosm/microcosm-staging-view";
import { LoadingBlock } from "@/components/shared/LoadingBlock";
import { localRunsEnabled } from "@/lib/microcosm/local-build-runs";

// The page is prerendered when the dashboard is built, so whether a local
// runs folder is set is read then: never on Vercel. `next dev` renders it on
// each request.
export default function MicrocosmStagingPage() {
  return (
    <AppShell>
      <Suspense fallback={<LoadingBlock label="Loading staging candidates…" />}>
        <MicrocosmStagingView localRunsEnabled={localRunsEnabled()} />
      </Suspense>
    </AppShell>
  );
}
