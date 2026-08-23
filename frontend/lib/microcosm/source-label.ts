import { sourceAuthorityLabel } from "@/lib/source-labels";

export function sourceLabel(source: string): string {
  return sourceAuthorityLabel(source);
}
