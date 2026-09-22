import { loadHfWebhookConfig } from "@/lib/microcosm/hf-webhook-config";
import { createHfWebhookHandler } from "@/lib/microcosm/hf-webhook-handler";

export const runtime = "nodejs";
// Push endpoint — must run on every call, never served from cache.
export const dynamic = "force-dynamic";

// Resolve deployment configuration once when the server module starts. The
// request handler itself receives explicit configuration and never reads the
// process environment.
export const POST = createHfWebhookHandler(loadHfWebhookConfig());
