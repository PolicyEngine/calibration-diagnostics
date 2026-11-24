// The collector's calibration tree store, which the release and staging
// calibration views read instead of Hugging Face.
import { get } from "@vercel/blob";

/**
 * The one Blob client the store readers use. Reads pass no token, so they use
 * the deployment's own Blob credentials, as the tree manifest's reads do.
 * Tests replace `get`.
 */
export const collectorStoreBlob = {
  get: ((...args: Parameters<typeof get>) => get(...args)) as typeof get,
};
