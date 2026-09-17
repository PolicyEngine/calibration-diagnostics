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
