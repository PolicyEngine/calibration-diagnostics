import type { BuildRunSource } from "@/lib/microcosm/build-monitor";

export function parseBuildSource(value: string | null | undefined): BuildRunSource {
  return value === "local" ? "local" : "staging";
}
