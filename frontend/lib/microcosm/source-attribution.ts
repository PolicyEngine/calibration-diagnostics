import type { MicrocosmCountry } from "./latest-artifact";

export interface MicrocosmSourceAttribution {
  label: string;
  href: string | null;
}

export function microcosmSourceAttribution(
  country: MicrocosmCountry,
  sourceRepo: string,
): MicrocosmSourceAttribution {
  if (country === "uk") {
    return {
      label: "the selected Microcosm UK release",
      href: null,
    };
  }

  return {
    label: sourceRepo,
    href: `https://huggingface.co/datasets/${sourceRepo}`,
  };
}
