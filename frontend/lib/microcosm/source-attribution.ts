import {
  countryRegistration,
  type MicrocosmCountry,
  type RepositoryVisibility,
} from "@policyengine/calibration-tree/countries";
import { parseBuildFolderId } from "@policyengine/calibration-tree/release-record";

export interface MicrocosmSourceAttribution {
  label: string;
  href: string | null;
}

function huggingFaceRepoPath(sourceRepo: string): string {
  return sourceRepo
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

// A release opens at its tag. A build in its own folder (`<release>/<build>`)
// has no tag, so it opens as its folder at the commit it was read from.
export function microcosmPublicationUrl(
  sourceRepo: string,
  releaseId: string,
  revision?: string | null,
): string {
  const repoPath = huggingFaceRepoPath(sourceRepo);
  const buildFolder = parseBuildFolderId(releaseId);
  if (buildFolder) {
    return (
      `https://huggingface.co/datasets/${repoPath}/tree/${encodeURIComponent(revision || "main")}` +
      `/releases/${encodeURIComponent(buildFolder.release)}/${encodeURIComponent(buildFolder.build)}`
    );
  }
  return `https://huggingface.co/datasets/${repoPath}/tree/${encodeURIComponent(releaseId)}`;
}

// Link the dataset only when its repository is public: the registration's
// visibility, or the release artifact's `repository_visibility` when supplied.
export function microcosmSourceAttribution(
  country: MicrocosmCountry,
  sourceRepo: string,
  visibility: RepositoryVisibility = countryRegistration(country).visibility,
): MicrocosmSourceAttribution {
  return {
    label: "Microcosm",
    href:
      visibility === "public"
        ? `https://huggingface.co/datasets/${sourceRepo}`
        : null,
  };
}
