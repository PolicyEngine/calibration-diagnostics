import {
  countryRegistration,
  type MicrocosmCountry,
  type RepositoryVisibility,
} from "./countries";

export interface MicrocosmSourceAttribution {
  label: string;
  href: string | null;
}

export function microcosmPublicationUrl(
  sourceRepo: string,
  releaseId: string,
): string {
  const repoPath = sourceRepo
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
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
