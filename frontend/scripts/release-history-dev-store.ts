/**
 * Writes the synthetic release history store to a folder (calibration-diagnostics#224), so the
 * page can be looked at with no production data and no Blob token:
 *
 *   bun run scripts/release-history-dev-store.ts --out ../.tmp/release-history-store
 *   RELEASE_HISTORY_LOCAL_DIR=../.tmp/release-history-store bun run dev
 *
 * then open /microcosm/release-history?country=uk. The values are made up: each country's
 * committed fixtures (its spec on a synthetic world) and a seeded generator, through the real
 * finalize and timeline code. See lib/microcosm/test-support/release-history-synthetic-store.ts
 * for the cases it holds. It writes local files only.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";

import { syntheticReleaseHistory } from "../lib/microcosm/test-support/release-history-synthetic-store";

/** Write every document of the synthetic store under `out`, in the store's layout. */
export async function writeSyntheticStore(out: string): Promise<{ files: number; countries: string[] }> {
  const { store, countries } = await syntheticReleaseHistory();
  for (const [path, object] of store.objects) {
    const target = join(out, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, object.body);
  }
  return { files: store.objects.size, countries: Object.keys(countries) };
}

if (import.meta.main) {
  const { values } = parseArgs({ args: process.argv.slice(2), options: { out: { type: "string" } } });
  if (!values.out) {
    console.error("Usage: release-history-dev-store.ts --out <folder>");
    process.exit(1);
  }
  const out = resolve(values.out);
  const written = await writeSyntheticStore(out);
  console.log(JSON.stringify({ out, ...written }));
}
