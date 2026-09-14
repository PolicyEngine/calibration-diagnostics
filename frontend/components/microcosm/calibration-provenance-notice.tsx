import type { CalibrationProvenance } from "@/lib/microcosm/target-loss-attribution";

export function CalibrationProvenanceNotice({
  provenance,
  subject,
}: {
  provenance: CalibrationProvenance | undefined;
  subject?: string;
}) {
  if (!provenance || provenance.mode !== "inherited") return null;

  const verified = provenance.validation.status === "verified";
  return (
    <div
      role={verified ? "status" : "alert"}
      className="rounded-lg border border-border bg-muted/30 px-4 py-3 text-xs leading-relaxed text-muted-foreground"
    >
      <p className="font-semibold text-foreground">
        {subject
          ? `${subject}: inherited calibration diagnostics`
          : "Inherited calibration diagnostics"}
      </p>
      <p className="mt-1">
        Calibration was not rerun for{" "}
        <span className="break-all font-mono text-foreground">
          {provenance.dataset_release_id}
        </span>
        . These diagnostics came from calibration build{" "}
        <span className="break-all font-mono text-foreground">
          {provenance.calibration_source_id ?? "not declared"}
        </span>
        {verified
          ? "; the diagnostics file digest and the digest of its calibrated target definitions and values match the pinned parent record."
          : `. Validation failed: ${provenance.validation.reason ?? "unknown reason"}.`}
      </p>
    </div>
  );
}

export function CalibrationComparisonProvenanceNotices({
  current,
  candidate,
}: {
  current: CalibrationProvenance | undefined;
  candidate: CalibrationProvenance | undefined;
}) {
  if (current?.mode !== "inherited" && candidate?.mode !== "inherited") {
    return null;
  }

  return (
    <div className="flex flex-col gap-3">
      <CalibrationProvenanceNotice
        provenance={current}
        subject="Current release"
      />
      <CalibrationProvenanceNotice provenance={candidate} subject="Candidate" />
    </div>
  );
}
