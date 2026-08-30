import { createServer } from "node:net";

const MIN_PORT = 1;
const MAX_PORT = 65_535;

function assertPort(port, label) {
  if (!Number.isInteger(port) || port < MIN_PORT || port > MAX_PORT) {
    throw new RangeError(`${label} must be an integer between ${MIN_PORT} and ${MAX_PORT}`);
  }
}

function canListen(port, host, ipv6Only = false) {
  return new Promise((resolve, reject) => {
    const server = createServer();

    server.once("error", (error) => {
      if (error.code === "EADDRINUSE") {
        resolve(false);
        return;
      }
      if (
        ipv6Only &&
        (error.code === "EAFNOSUPPORT" || error.code === "EADDRNOTAVAIL")
      ) {
        resolve(true);
        return;
      }
      reject(error);
    });

    server.listen({ port, host, exclusive: true, ipv6Only }, () => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(true);
      });
    });
  });
}

export async function isPortAvailable(port) {
  assertPort(port, "port");

  if (!(await canListen(port, "127.0.0.1"))) return false;
  return canListen(port, "::1", true);
}

export async function findAvailablePort(startPort = 3000, maxPort = MAX_PORT) {
  assertPort(startPort, "startPort");
  assertPort(maxPort, "maxPort");
  if (maxPort < startPort) {
    throw new RangeError("maxPort must be greater than or equal to startPort");
  }

  for (let port = startPort; port <= maxPort; port += 1) {
    if (await isPortAvailable(port)) return port;
  }

  throw new Error(`No available port found from ${startPort} through ${maxPort}`);
}
