"use client";

import { useEffect } from "react";

import { useDatasets, useRuns } from "@/lib/api/hooks/use-runs";
import { useRunContext } from "@/lib/run-context";

/**
 * Headless component that auto-picks a default dataset+run on a cold visit
 * (no ?dataset=&run= in the URL). Replaces the auto-default effects that
 * used to live on RunPicker, so the app still has a sensible default after
 * the global picker UI was removed.
 *
 * Prefers `us-data` (canonical) over `us-cps` (sandbox) when both are
 * available — the canonical dataset is what users actually want to see by
 * default.
 */
export function RunBootstrap() {
  const { dataset, run, setSelection } = useRunContext();
  const datasetsQ = useDatasets();
  const runsQ = useRuns(dataset);

  useEffect(() => {
    if (!dataset && datasetsQ.data && datasetsQ.data.length > 0) {
      const preferred =
        datasetsQ.data.find((d) => d.id === "us-data") ?? datasetsQ.data[0];
      setSelection({ dataset: preferred.id, run: null });
    }
  }, [dataset, datasetsQ.data, setSelection]);

  useEffect(() => {
    if (dataset && !run && runsQ.data && runsQ.data.length > 0) {
      setSelection({ dataset, run: runsQ.data[0].run_id });
    }
  }, [dataset, run, runsQ.data, setSelection]);

  return null;
}
