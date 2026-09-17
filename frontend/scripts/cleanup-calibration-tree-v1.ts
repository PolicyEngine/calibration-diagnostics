import {
  deleteLegacyCalibrationTreeBlobs,
  listLegacyCalibrationTreeBlobs,
} from "../lib/microcosm/calibration-tree-blob";

export function shouldExecuteCleanup(argv: string[]): boolean {
  for (const argument of argv) {
    if (argument !== "--execute") {
      throw new Error(`Unknown cleanup argument ${argument}.`);
    }
  }
  return argv.includes("--execute");
}

export async function runCleanup(execute: boolean): Promise<string[]> {
  const token = process.env.BLOB_READ_WRITE_TOKEN?.trim();
  if (!token) throw new Error("BLOB_READ_WRITE_TOKEN is required.");
  const paths = await listLegacyCalibrationTreeBlobs({ token });
  for (const path of paths) console.log(path);
  if (!execute) {
    console.log(`Dry run: ${paths.length} obsolete Blob object(s) would be deleted.`);
    return paths;
  }
  await deleteLegacyCalibrationTreeBlobs({ token, paths });
  console.log(`Deleted ${paths.length} obsolete Blob object(s).`);
  return paths;
}

if (import.meta.main) {
  try {
    await runCleanup(shouldExecuteCleanup(Bun.argv.slice(2)));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
