import "server-only";

import { getVercelOidcToken } from "@vercel/oidc";
import { GoogleAuth, IdentityPoolClient } from "google-auth-library";

const CLOUD_PLATFORM_SCOPE = "https://www.googleapis.com/auth/cloud-platform";
const SECRET_CACHE_MS = 60_000;
const SECRET_VERSION_PATTERN =
  /^projects\/[a-zA-Z0-9-]+\/secrets\/[a-zA-Z0-9_-]+\/versions\/(?:[1-9][0-9]*|latest)$/;
const PROVIDER_PATTERN =
  /^projects\/[0-9]+\/locations\/global\/workloadIdentityPools\/[a-z0-9-]+\/providers\/[a-z0-9-]+$/;

export const WORKLOAD_IDENTITY_PROVIDER_ENV =
  "MICROCOSM_TELEMETRY_GOOGLE_IDENTITY_PROVIDER";

type SecretResponse = { payload?: { data?: string } };
type AccessVersion = (name: string) => Promise<SecretResponse>;

export function validSecretVersion(name: string): boolean {
  return SECRET_VERSION_PATTERN.test(name);
}

export async function secretManagerAuth(
  environment: Record<string, string | undefined> = process.env,
) {
  if (environment.VERCEL === "1") {
    const provider = environment[WORKLOAD_IDENTITY_PROVIDER_ENV]?.trim();
    if (!provider || !PROVIDER_PATTERN.test(provider)) {
      throw new Error(`Configure ${WORKLOAD_IDENTITY_PROVIDER_ENV}.`);
    }
    return new IdentityPoolClient({
      audience: `//iam.googleapis.com/${provider}`,
      subject_token_type: "urn:ietf:params:oauth:token-type:jwt",
      token_url: "https://sts.googleapis.com/v1/token",
      scopes: [CLOUD_PLATFORM_SCOPE],
      subject_token_supplier: {
        getSubjectToken: () => getVercelOidcToken(),
      },
    });
  }
  // Local development uses the developer's Google application credentials.
  return new GoogleAuth({ scopes: [CLOUD_PLATFORM_SCOPE] }).getClient();
}

async function accessVersion(name: string): Promise<SecretResponse> {
  const auth = await secretManagerAuth();
  const response = await auth.request<SecretResponse>({
    url: `https://secretmanager.googleapis.com/v1/${name}:access`,
    method: "GET",
    timeout: 10_000,
    retry: false,
  });
  return response.data;
}

export function createSecretReader(
  access: AccessVersion,
  now: () => number = Date.now,
) {
  const cache = new Map<string, { expires: number; value: Promise<string> }>();

  return {
    async readVersion(name: string): Promise<string> {
      if (!validSecretVersion(name)) {
        throw new Error("Invalid Google Secret Manager version resource.");
      }
      const cached = cache.get(name);
      if (cached && cached.expires > now()) return cached.value;

      const value = Promise.resolve()
        .then(() => access(name))
        .then((response) => {
          const data = response.payload?.data;
          if (!data) throw new Error("Empty secret response.");
          const decoded = Buffer.from(data, "base64").toString("utf8");
          if (!decoded) throw new Error("Empty secret value.");
          return decoded;
        })
        .catch(() => {
          if (cache.get(name)?.value === value) cache.delete(name);
          // Google client errors may include headers or response payloads.
          throw new Error(
            "Unable to load the telemetry credential from Secret Manager.",
          );
        });
      cache.set(name, { expires: now() + SECRET_CACHE_MS, value });
      return value;
    },
  };
}

export const secretManager = createSecretReader(accessVersion);
