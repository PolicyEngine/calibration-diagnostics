import { expect, test } from "bun:test";
import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  directoryStore,
  RELEASE_HISTORY_LOCAL_DIR_ENV,
  releaseHistoryLocalDirectory,
} from "./release-history-source";
import { readJson, RELEASE_HISTORY_MANIFEST_PATH } from "./release-history-store";

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
