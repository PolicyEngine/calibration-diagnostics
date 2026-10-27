import { expect, mock, test } from "bun:test";
import { IdentityPoolClient } from "google-auth-library";

import { createSecretReader, secretManagerAuth } from "./secret-manager";

const resource = "projects/test-project/secrets/read-token/versions/latest";
const encoded = (value: string) => ({
  payload: { data: Buffer.from(value).toString("base64") },
});

test("shares an in-flight read and refreshes the cached secret", async () => {
  let now = 0;
  const access = mock(async () => encoded("first"));
  const reader = createSecretReader(access, () => now);
  expect(
    await Promise.all([
      reader.readVersion(resource),
      reader.readVersion(resource),
    ]),
  ).toEqual(["first", "first"]);
  expect(access).toHaveBeenCalledTimes(1);
  access.mockResolvedValue(encoded("second"));
  now = 60_001;
  expect(await reader.readVersion(resource)).toBe("second");
  expect(access).toHaveBeenCalledTimes(2);
});

test("a read still in flight 5 seconds after it began is not shared", async () => {
  // The build monitor's Candidate tab stops waiting for the collector's run
  // list after 5 seconds, which can leave this read in flight with nothing
  // keeping it running. Vercel can then suspend the instance, and the read's
  // overdue 10-second timeout fires when a later call resumes the instance.
  let now = 0;
  let failFirstRead!: (error: Error) => void;
  const access = mock(async () => encoded("fresh"));
  access.mockImplementationOnce(
    () =>
      new Promise((_resolve, reject) => {
        failFirstRead = reject;
      }),
  );
  const reader = createSecretReader(access, () => now);
  const firstRead = reader.readVersion(resource);
  now = 4_999;
  const sharedRead = reader.readVersion(resource);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(access).toHaveBeenCalledTimes(1);

  now = 5_000;
  const laterRead = reader.readVersion(resource);
  failFirstRead(new Error("The operation was aborted due to timeout"));
  const [first, shared, later] = await Promise.allSettled([
    firstRead,
    sharedRead,
    laterRead,
  ]);
  expect([first.status, shared.status]).toEqual(["rejected", "rejected"]);
  expect(later).toEqual({ status: "fulfilled", value: "fresh" });
  expect(access).toHaveBeenCalledTimes(2);

  // A read that answered is still reused for 60 seconds after it began.
  now = 64_999;
  expect(await reader.readVersion(resource)).toBe("fresh");
  expect(access).toHaveBeenCalledTimes(2);
});

test("keeps distinct secret versions in separate cache entries", async () => {
  const access = mock(async (name: string) =>
    encoded(name.endsWith("/1") ? "first" : "latest"),
  );
  const reader = createSecretReader(access);
  expect(await reader.readVersion(resource)).toBe("latest");
  expect(await reader.readVersion(resource.replace("latest", "1"))).toBe(
    "first",
  );
  expect(access).toHaveBeenCalledTimes(2);
});

test("failed requests are redacted and can be retried", async () => {
  const access = mock(async () => {
    throw new Error("sensitive payload or credentials");
  });
  const reader = createSecretReader(access);
  for (let attempt = 0; attempt < 2; attempt++) {
    await expect(reader.readVersion(resource)).rejects.toThrow(
      "Unable to load the telemetry credential from Secret Manager.",
    );
  }
  expect(access).toHaveBeenCalledTimes(2);
});

test("concurrent callers receive only the redacted error", async () => {
  const reader = createSecretReader(async () => {
    throw new Error("sensitive credential");
  });
  const results = await Promise.allSettled([
    reader.readVersion(resource),
    reader.readVersion(resource),
  ]);
  for (const result of results) {
    expect(result.status).toBe("rejected");
    if (result.status === "rejected") {
      expect(result.reason.message).toBe(
        "Unable to load the telemetry credential from Secret Manager.",
      );
    }
  }
});

test("rejects an invalid resource before making a Google request", async () => {
  const access = mock(async () => encoded("unused"));
  const reader = createSecretReader(access);
  await expect(
    reader.readVersion("https://another-host/credential"),
  ).rejects.toThrow("Invalid Google");
  expect(access).not.toHaveBeenCalled();
});

test("rejects a secret response without a payload", async () => {
  const reader = createSecretReader(async () => ({}));
  await expect(reader.readVersion(resource)).rejects.toThrow("Unable to load");
});

test("Vercel requires workload identity configuration", async () => {
  await expect(secretManagerAuth({ VERCEL: "1" })).rejects.toThrow(
    "Configure MICROCOSM_TELEMETRY_GOOGLE_IDENTITY_PROVIDER",
  );
  const auth = await secretManagerAuth({
    VERCEL: "1",
    MICROCOSM_TELEMETRY_GOOGLE_IDENTITY_PROVIDER:
      "projects/123/locations/global/workloadIdentityPools/test/providers/vercel",
  });
  expect(auth).toBeInstanceOf(IdentityPoolClient);
});
