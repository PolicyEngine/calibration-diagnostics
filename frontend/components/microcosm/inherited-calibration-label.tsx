"use client";

import Link from "next/link";
import type { CalibrationProvenance } from "@policyengine/calibration-tree/target-loss-attribution";

import { useCountry } from "@/components/layout/country-context";
import { useBuildRun } from "@/lib/api/hooks/use-microcosm";
import {
  inheritedCalibrationSource,
  parentStagingRunId,
  type InheritedCalibrationSource,
} from "@/lib/microcosm/inherited-calibration";

export function InheritedCalibrationLabel({
  parentBuildId,
  buildProgressHref,
}: InheritedCalibrationSource) {
  return (
    <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
      <span>Calibration inherited from parent build</span>
      <code className="break-all font-mono text-foreground">{parentBuildId}</code>
      {buildProgressHref && (
        <>
          <span aria-hidden="true">·</span>
          <Link href={buildProgressHref} className="font-medium text-primary hover:underline">
            Build progress
          </Link>
        </>
      )}
    </p>
  );
}

// The calibration map's line naming the build whose calibration this build
// inherits, with a link to that build's staging run when the build monitor
// finds it.
export function InheritedCalibration({
  provenance,
}: {
  provenance: CalibrationProvenance | undefined;
}) {
  const { country } = useCountry();
  const { data: parentRun } = useBuildRun("staging", parentStagingRunId(provenance, country));
  const source = inheritedCalibrationSource(provenance, country, parentRun);
  return source ? <InheritedCalibrationLabel {...source} /> : null;
}
