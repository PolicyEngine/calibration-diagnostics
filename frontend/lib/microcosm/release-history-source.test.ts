import { expect, test } from "bun:test";
import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  directoryStore,
  RELEASE_HISTORY_LOCAL_DIR_ENV,
  releaseHistoryLocalDirectory,
  releaseHistoryReadStore,
} from "./release-history-source";
import {
  encodeDocument,
  memoryStore,
  readJson,
  RELEASE_HISTORY_MANIFEST_PATH,
  type ReleaseHistoryStore,
} from "./release-history-store";

async function folder(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "release-history-source-"));
  await mkdir(join(root, "release-history", "zz", "a".repeat(64)), { recursive: true });
  await writeFile(join(root, RELEASE_HISTORY_MANIFEST_PATH), JSON.stringify({ formatVersion: 1 }));
  await writeFile(join(root, "release-history", "zz", "series.json"), "{}");
  await writeFile(join(root, "release-history", "zz", "a".repeat(64), "timeline.json"), "{}");
  return root;
}

test("a local folder reads and lists in the store's layout, and is never written", async () => {
  const store = directoryStore(await folder());
  expect(await readJson<{ formatVersion: number }>(store, RELEASE_HISTORY_MANIFEST_PATH)).toEqual({ formatVersion: 1 });
  expect(await store.read("release-history/zz/labels.json")).toBeNull();
  // A folder where a file is asked for is not a document.
  expect(await store.read("release-history/zz")).toBeNull();
  expect(await store.list("release-history/zz/")).toEqual([
    `release-history/zz/${"a".repeat(64)}/timeline.json`,
    "release-history/zz/series.json",
  ]);
  expect(await store.list("release-history/us/")).toEqual([]);
  await expect(store.write("release-history/zz/series.json", new Uint8Array(), "replace", false))
    .rejects.toThrow("read-only");
});

test("a path that leaves the folder is not read, and a link is not followed when listing", async () => {
  const root = await folder();
  const outside = await mkdtemp(join(tmpdir(), "release-history-outside-"));
  await writeFile(join(outside, "secret.json"), "{}");
  await symlink(outside, join(root, "release-history", "linked"));
  const store = directoryStore(root);
  expect(await store.read(`../${outside.split("/").pop()}/secret.json`)).toBeNull();
  expect(await store.read("/etc/hosts")).toBeNull();
  expect((await store.list("release-history/")).some((path) => path.includes("linked"))).toBe(false);
});

test("the folder is read only when the environment names it", () => {
  expect(releaseHistoryLocalDirectory({})).toBeNull();
  expect(releaseHistoryLocalDirectory({ [RELEASE_HISTORY_LOCAL_DIR_ENV]: "  " })).toBeNull();
  expect(releaseHistoryLocalDirectory({ [RELEASE_HISTORY_LOCAL_DIR_ENV]: "/tmp/store" })).toBe("/tmp/store");
});

test("Blob is read with the deployment's own credentials: no token is passed, whatever the environment holds", async () => {
  const blob = memoryStore();
  await blob.write(RELEASE_HISTORY_MANIFEST_PATH, encodeDocument({ formatVersion: 1 }), "create", false);
  const calls: unknown[][] = [];
  const blobStore = (...credentials: unknown[]): ReleaseHistoryStore => {
    calls.push(credentials);
    return blob;
  };
  // A token in the environment is the Blob client's to pick, after OIDC with BLOB_STORE_ID.
  for (const environment of [{}, { BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_secret", BLOB_STORE_ID: "store_1" }]) {
    const store = releaseHistoryReadStore(environment, blobStore);
    expect(await readJson<{ formatVersion: number }>(store, RELEASE_HISTORY_MANIFEST_PATH)).toEqual({ formatVersion: 1 });
    expect(await store.list("release-history/")).toEqual([RELEASE_HISTORY_MANIFEST_PATH]);
    // The page only reads: nothing is written through the store it is given.
    await expect(store.write(RELEASE_HISTORY_MANIFEST_PATH, new Uint8Array(), "replace", false)).rejects.toThrow("never writes");
  }
  expect(calls).toEqual([[], []]);
  expect(await readJson<{ formatVersion: number }>(blob, RELEASE_HISTORY_MANIFEST_PATH)).toEqual({ formatVersion: 1 });
});

test("a named local folder is read in place of Blob, which is then never opened", async () => {
  const root = await folder();
  let opened = 0;
  const store = releaseHistoryReadStore({ [RELEASE_HISTORY_LOCAL_DIR_ENV]: root, BLOB_READ_WRITE_TOKEN: "unused" }, () => {
    opened += 1;
    return memoryStore();
  });
  expect(await readJson<{ formatVersion: number }>(store, RELEASE_HISTORY_MANIFEST_PATH)).toEqual({ formatVersion: 1 });
  expect(opened).toBe(0);
});
