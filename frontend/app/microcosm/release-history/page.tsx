import type { Metadata } from "next";
import { Suspense } from "react";

import { AppShell } from "@/components/layout/app-shell";
import { ReleaseHistoryView } from "@/components/microcosm/release-history-view";
import { LoadingBlock } from "@/components/shared/LoadingBlock";

export const metadata: Metadata = { title: "Release history" };

// Listed in the sidebar under Releases for every country with the `calibration` capability
// (components/layout/nav-items.ts). A country the dashboard does not serve gets the shell's
// not-configured state, and one with no measured file an empty state.
export default function ReleaseHistoryPage() {
  return (
    <AppShell>
      <Suspense fallback={<LoadingBlock label="Loading the release history…" />}>
        <ReleaseHistoryView />
      </Suspense>
    </AppShell>
  );
}
