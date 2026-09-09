import hostedRelease from "@/scripts/hosted_release.json";

// Shared with the hosted Python loader. Changing this selection requires a
// reviewed model/data bundle and an application rebuild.
export const HOSTED_US_RELEASE = hostedRelease;

export class IncompatibleProductionReleaseError extends Error {
  status = 409;
}

export function reviewedVariableRelease(requested?: string | null): string {
  const release = requested?.trim() || HOSTED_US_RELEASE.release_id;
  if (release !== HOSTED_US_RELEASE.release_id) {
    throw new IncompatibleProductionReleaseError(
      `Variable lookup supports the pinned production release ${HOSTED_US_RELEASE.release_id}. ` +
      `Requested release ${release} is not supported by this runtime.`,
    );
  }
  return release;
}

export function assertReviewedRepository(repo: string, revision: string): void {
  if (repo !== HOSTED_US_RELEASE.repo || revision !== HOSTED_US_RELEASE.hf_revision) {
    throw new IncompatibleProductionReleaseError(
      "The US dashboard requires its reviewed immutable production data selection. " +
      "Remove conflicting POPULACE_HF_REPO/POPULACE_HF_REVISION overrides and rebuild.",
    );
  }
}
