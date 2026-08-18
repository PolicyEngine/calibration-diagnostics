import type { MicrocosmCountry } from "./latest-artifact";

export interface MicrocosmSourceAttribution {
  label: string;
  href: string | null;
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
