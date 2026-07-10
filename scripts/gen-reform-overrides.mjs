// Regenerate frontend/lib/populace/reform-overrides.ts from the committed
// reform-overrides/*.json files. Each JSON is a full reform_validation payload
// (see fetchReformValidation in reforms.ts); this file maps release_id -> payload
// so the dashboard can serve a committed backfill without a Hugging Face
// round-trip. Static imports keep the JSON bundler-safe on both server and client.
//
// The scheduled reform-validation job (.github/workflows/reform-validation-backfill.yml)
// drops a new JSON here and re-runs this generator, so no release ever needs a
// hand-edit of the .ts. Provenance for each file lives in its own _backfill_note.
//
//   node scripts/gen-reform-overrides.mjs           # rewrite the .ts
//   node scripts/gen-reform-overrides.mjs --check    # fail if out of date (CI)

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(root, "frontend", "lib", "populace", "reform-overrides");
const outFile = join(root, "frontend", "lib", "populace", "reform-overrides.ts");

const HEADER = `// Committed reform_validation.json backfills, keyed by release id.
//
// A release can reach the dashboard without a reform_validation.json: builds
// published before out-of-sample simulation was restored (PolicyEngine/populace#175)
// shipped one with null out-of-sample rows, and builds promoted to \`latest\` that
// skipped the reform-validation step entirely shipped none at all. Both are
// backfilled here — the producer run offline on the released populace_us_2024.h5
// at the build's exact package versions — so the dashboard shows the real numbers
// without a Hugging Face round-trip or republish. \`fetchReformValidation\` prefers
// / merges a committed override over the native artifact. Provenance for each file
// is in its own _backfill_note.
//
// THIS FILE IS GENERATED. Do not edit by hand — drop a JSON in reform-overrides/
// and run \`node scripts/gen-reform-overrides.mjs\`. The scheduled backfill workflow
// does this automatically for each new release.`;

function identFor(fileName) {
  // Deterministic, collision-free JS identifier from the file name.
  return "rv_" + fileName.replace(/\.json$/, "").replace(/[^a-zA-Z0-9]/g, "_");
}

const files = readdirSync(dir)
  .filter((f) => f.endsWith(".json"))
  .sort();

const entries = files.map((file) => {
  const payload = JSON.parse(readFileSync(join(dir, file), "utf8"));
  const releaseId = payload.release_id;
  if (typeof releaseId !== "string" || !releaseId) {
    throw new Error(`${file}: missing string release_id`);
  }
  return { file, ident: identFor(file), releaseId };
});

// Guard against two files claiming the same release id.
const byRelease = new Map();
for (const e of entries) {
  if (byRelease.has(e.releaseId)) {
    throw new Error(
      `duplicate release_id ${e.releaseId} in ${byRelease.get(e.releaseId)} and ${e.file}`,
    );
  }
  byRelease.set(e.releaseId, e.file);
}

const imports = entries.map((e) => `import ${e.ident} from "./reform-overrides/${e.file}";`).join("\n");
const mapBody = entries.map((e) => `  ${JSON.stringify(e.releaseId)}: ${e.ident},`).join("\n");

const out = `${HEADER}

${imports}

export const REFORM_OVERRIDES: Record<string, unknown> = {
${mapBody}
};
`;

if (process.argv.includes("--check")) {
  const current = readFileSync(outFile, "utf8");
  if (current !== out) {
    console.error(
      "reform-overrides.ts is out of date. Run: node scripts/gen-reform-overrides.mjs",
    );
    process.exit(1);
  }
  console.log(`reform-overrides.ts up to date (${entries.length} overrides).`);
} else {
  writeFileSync(outFile, out);
  console.log(`wrote reform-overrides.ts with ${entries.length} overrides.`);
}
