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
  const datasetIsValid =
    !!dataset && !!datasetsQ.data?.some((d) => d.id === dataset);
  const runsQ = useRuns(datasetIsValid ? dataset : null);

  useEffect(() => {
    if (datasetsQ.data && datasetsQ.data.length > 0 && !datasetIsValid) {
      const preferred =
        datasetsQ.data.find((d) => d.id === "us-data") ?? datasetsQ.data[0];
      setSelection({ dataset: preferred.id, run: null });
    }
  }, [datasetIsValid, datasetsQ.data, setSelection]);

  useEffect(() => {
    if (!datasetIsValid || !dataset || !runsQ.data) return;
    const runIsValid = !!run && runsQ.data.some((r) => r.run_id === run);
    if (!runIsValid) {
      setSelection({ dataset, run: runsQ.data[0]?.run_id ?? null });
    }
  }, [dataset, datasetIsValid, run, runsQ.data, setSelection]);

  return null;
}
