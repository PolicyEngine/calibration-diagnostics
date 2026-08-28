import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { createServer } from "node:net";

import { findAvailablePort, isPortAvailable } from "./available-port.mjs";

const openServers = [];

afterEach(async () => {
  await Promise.all(
    openServers.splice(0).map(
      (server) =>
        new Promise((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        }),
    ),
  );
});

async function occupyEphemeralIpv4Port() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen({ port: 0, host: "127.0.0.1" }, resolve);
  });
  openServers.push(server);
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected the test server to have a TCP address");
  }
  return address.port;
}

async function occupyEphemeralIpv6Port() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen({ port: 0, host: "::1", ipv6Only: true }, resolve);
  });
  openServers.push(server);
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected the test server to have a TCP address");
  }
  return address.port;
}

describe("development port selection", () => {
  test("recognizes a port occupied only on IPv4", async () => {
    const occupiedPort = await occupyEphemeralIpv4Port();

    assert.equal(await isPortAvailable(occupiedPort), false);
  });

  test("recognizes a port occupied only on IPv6", async (context) => {
    let occupiedPort;
    try {
      occupiedPort = await occupyEphemeralIpv6Port();
    } catch (error) {
      if (error.code === "EAFNOSUPPORT" || error.code === "EADDRNOTAVAIL") {
        context.skip("IPv6 loopback is not available on this host");
        return;
      }
      throw error;
    }

    assert.equal(await isPortAvailable(occupiedPort), false);
  });

  test("increments until it finds a free port", async () => {
    const occupiedPort = await occupyEphemeralIpv4Port();

    const selectedPort = await findAvailablePort(occupiedPort);

    assert.ok(selectedPort > occupiedPort);
    assert.equal(await isPortAvailable(selectedPort), true);
  });

  test("reports when the requested range is fully occupied", async () => {
    const occupiedPort = await occupyEphemeralIpv4Port();

    await assert.rejects(
      findAvailablePort(occupiedPort, occupiedPort),
      new Error(`No available port found from ${occupiedPort} through ${occupiedPort}`),
    );
  });
});
