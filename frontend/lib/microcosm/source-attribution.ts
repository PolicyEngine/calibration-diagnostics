import type { MicrocosmCountry } from "./latest-artifact";

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

export function microcosmSourceAttribution(
  country: MicrocosmCountry,
  sourceRepo: string,
): MicrocosmSourceAttribution {
  return {
    label: "Microcosm",
    href:
      country === "us"
        ? `https://huggingface.co/datasets/${sourceRepo}`
        : null,
  };
}
