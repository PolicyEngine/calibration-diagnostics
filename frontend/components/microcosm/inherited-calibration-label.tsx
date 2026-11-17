"use client";

import Link from "next/link";
import type { CalibrationProvenance } from "@policyengine/calibration-tree/target-loss-attribution";

import { useCountry } from "@/components/layout/country-context";
import { useMicrocosmParentBuild } from "@/lib/api/hooks/use-microcosm";
import {
  inheritedCalibrationSource,
  parentBuildRelease,
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

// The calibration map's row naming the build whose calibration this release
// build inherits, with a link to that build's staging run when the parent's
// build manifest records one.
export function InheritedCalibration({
  provenance,
  releaseId,
}: {
  provenance: CalibrationProvenance | undefined;
  releaseId: string | undefined;
}) {
  const { country } = useCountry();
  const { data: parentBuild } = useMicrocosmParentBuild(
    parentBuildRelease(provenance, country, releaseId),
  );
  const source = inheritedCalibrationSource(provenance, country, parentBuild);
  return source ? <InheritedCalibrationLabel {...source} /> : null;
}
