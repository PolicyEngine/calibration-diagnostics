/**
 * The telemetry collector's base address, from a set, trimmed value of
 * MICROCOSM_TELEMETRY_COLLECTOR_URL, without its trailing slash. The one rule
 * for that setting, used by the build monitor's collector client
 * (telemetry-collector-client.ts) and by the Hugging Face webhook's
 * calibration-tree build requests (lib/microcosm/hf-webhook-config.ts).
 *
 * The address must use HTTPS, except HTTP on localhost or 127.0.0.1, and must
 * not contain credentials, a query or a fragment. A value that breaks a rule
 * throws an Error whose message is a fixed sentence; a value that is not a URL
 * throws the TypeError of `new URL`.
 */
export function telemetryCollectorBaseUrl(rawUrl: string): string {
  const url = new URL(rawUrl);
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
    throw new Error(
      "Telemetry collector URL must use HTTPS except on localhost.",
    );
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error(
      "Telemetry collector URL must not contain credentials or query data.",
    );
  }
  return url.toString().replace(/\/$/, "");
}
