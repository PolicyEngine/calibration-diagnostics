import "server-only";

import { getVercelOidcToken } from "@vercel/oidc";

// The deployment's Vercel OIDC token: on Vercel, the token of the request
// being served; locally, `VERCEL_OIDC_TOKEN` from `vercel env pull`. An
// object, so tests can replace the token.
export const vercelOidc = {
  token(): Promise<string> {
    return getVercelOidcToken();
  },
};
