/**
 * Where the release history routes read from (calibration-diagnostics#224): the private Vercel
 * Blob store, or a local folder in the same layout.
 *
 * Blob is read as the dashboard's other Blob reads are (frontend/HOSTED_RUNTIME.md): with no
 * credential passed, so `@vercel/blob` uses the deployment's Vercel OIDC token with
 * `BLOB_STORE_ID` when both are present, and `BLOB_READ_WRITE_TOKEN` otherwise. The page needs no
 * setting of its own, and it never writes.
 *
 * The folder is for development and for looking at a pulled panel: `scripts/release-history.ts
 * pull --out <dir>` and the Python producer both write this layout. It is read only when
 * RELEASE_HISTORY_LOCAL_DIR names it, so a hosted deployment never reads its own filesystem.
 */
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import {
  vercelBlobStore,
  type ReleaseHistoryStore,
  type StoredObject,
} from "./release-history-store";

export const RELEASE_HISTORY_LOCAL_DIR_ENV = "RELEASE_HISTORY_LOCAL_DIR";

const MISSING = new Set(["ENOENT", "ENOTDIR", "EISDIR"]);

function isMissing(error: unknown): boolean {
  return MISSING.has((error as NodeJS.ErrnoException | null)?.code ?? "");
}

async function filesUnder(directory: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }
  const files: string[] = [];
  for (const entry of entries) {
    const child = path.join(directory, entry.name);
    // A link could lead out of the folder, so it is never followed.
    if (entry.isDirectory()) files.push(...await filesUnder(child));
    else if (entry.isFile()) files.push(child);
  }
  return files;
}

/** A read-only store over a local folder that holds `release-history/...` as Blob does. */
export function directoryStore(root: string): ReleaseHistoryStore {
  const base = path.resolve(root);
  const inside = (storePath: string): string | null => {
    const resolved = path.resolve(base, storePath);
    return resolved.startsWith(`${base}${path.sep}`) ? resolved : null;
  };
  return {
    async read(storePath): Promise<StoredObject | null> {
      const file = inside(storePath);
      if (!file) return null;
      try {
        const [body, facts] = await Promise.all([readFile(file), stat(file)]);
        return { body: new Uint8Array(body), etag: `"${facts.size}-${Math.round(facts.mtimeMs)}"` };
      } catch (error) {
        if (isMissing(error)) return null;
        throw error;
      }
    },
    async write(storePath) {
      throw new Error(`The local release history folder is read-only: ${storePath} was not written.`);
    },
    async list(prefix) {
      return (await filesUnder(base))
        .map((file) => path.relative(base, file).split(path.sep).join("/"))
        .filter((storePath) => storePath.startsWith(prefix))
        .sort();
    },
  };
}

/** The local folder the environment names, or null when it names none. */
export function releaseHistoryLocalDirectory(
  environment: Record<string, string | undefined> = process.env,
): string | null {
  const named = environment[RELEASE_HISTORY_LOCAL_DIR_ENV]?.trim();
  return named ? path.resolve(named) : null;
}

/** A store's reads, with no way to write through it. */
function readOnly(store: ReleaseHistoryStore): ReleaseHistoryStore {
  return {
    read: (storePath) => store.read(storePath),
    list: (prefix) => store.list(prefix),
    async write(storePath) {
      throw new Error(`The dashboard never writes the release history: ${storePath} was not written.`);
    },
  };
}

/**
 * The store the page's routes read: the named local folder, otherwise private Blob with the
 * deployment's own credentials. `blobStore` is called with no token, whatever the environment
 * holds, so the Blob client picks the credential as it does for every other read of the dashboard.
 */
export function releaseHistoryReadStore(
  environment: Record<string, string | undefined> = process.env,
  blobStore: () => ReleaseHistoryStore = vercelBlobStore,
): ReleaseHistoryStore {
  const directory = releaseHistoryLocalDirectory(environment);
  return directory ? directoryStore(directory) : readOnly(blobStore());
}
