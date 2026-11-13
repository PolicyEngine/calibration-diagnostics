import {
  resolveRegisteredRepository,
  resolveRegisteredStagingRepository,
  selectableCountries,
  type MicrocosmCountry,
  type RepositoryEnvironment,
} from "@policyengine/calibration-tree/countries";
import { huggingFaceReadToken } from "@policyengine/calibration-tree/latest-artifact";

import { telemetryCollectorBaseUrl } from "@/lib/server/microcosm/telemetry-collector-url";
import { hasReleaseAlertChannel } from "@/lib/slack";

export interface WebhookRepositoryRegistration {
  country: MicrocosmCountry;
  kind: "release" | "staging";
  /**
   * The repository's name as configured, in its configured letter case. The
   * map of registrations is keyed by its lower-case form, so a delivery that
   * spells the name differently still finds it; the collector's
   * calibration-tree build request names the repository this way, since the
   * collector compares names exactly.
   */
  repo: string;
}

/**
 * Where the webhook asks the telemetry collector to queue calibration-tree
 * builds: the base address from MICROCOSM_TELEMETRY_COLLECTOR_URL, or, for a
 * value that breaks the address rules (telemetryCollectorBaseUrl), the
 * problem, a fixed sentence that never repeats the value.
 */
export type TreeBuildCollectorAddress =
  | { baseUrl: string }
  | { problem: string };

export interface HfWebhookConfig {
  secret: string | undefined;
  githubToken: string | undefined;
  /**
   * Reads a release repository's releases.json for the Slack release alerts
   * (the UK repository is private). Resolved by huggingFaceReadToken, as
   * the dashboard's other Hugging Face reads are, but once, when the server
   * module starts, like the rest of this configuration: a new token takes a
   * redeploy, as a new HF_WEBHOOK_SECRET does.
   */
  huggingFaceToken: string | undefined;
  /**
   * The countries whose Slack channel for release alerts is configured
   * (lib/slack.ts), read once, when the server module starts: a changed
   * SLACK_WEBHOOK_POPULACE_* variable takes effect with the next deployment.
   * Only their release repositories' releases.json is read for alerts, so
   * only they can be answered 503 when the read fails.
   */
  releaseAlertCountries: ReadonlySet<MicrocosmCountry>;
  githubRepository: string;
  githubWorkflow: string;
  repositories: ReadonlyMap<string, WebhookRepositoryRegistration>;
  /**
   * The collector address for calibration-tree build requests, read once,
   * when the server module starts, like the rest of this configuration: a
   * changed MICROCOSM_TELEMETRY_COLLECTOR_URL takes effect with the next
   * deployment. Absent when the setting is unset or empty: the webhook then
   * sends no request and answers tree_build "not_configured". An invalid
   * address is kept as its problem and never thrown here, so the webhook
   * still dispatches; each delivery reports it as a failed request.
   */
  treeBuildCollector?: TreeBuildCollectorAddress;
}

export type HfWebhookEnvironment = RepositoryEnvironment;

export function resolveHfWebhookConfig(
  environment: HfWebhookEnvironment,
): HfWebhookConfig {
  const repositories = new Map<string, WebhookRepositoryRegistration>();

  for (const country of selectableCountries()) {
    const releaseRepository = resolveRegisteredRepository(country, environment);
    repositories.set(releaseRepository.repo.toLowerCase(), {
      country,
      kind: "release",
      repo: releaseRepository.repo,
    });

    const stagingRepository = resolveRegisteredStagingRepository(
      country,
      environment,
    );
    if (stagingRepository) {
      repositories.set(stagingRepository.repo.toLowerCase(), {
        country,
        kind: "staging",
        repo: stagingRepository.repo,
      });
    }
  }

  return {
    secret: environment.HF_WEBHOOK_SECRET,
    githubToken: environment.GITHUB_ACTIONS_DISPATCH_TOKEN?.trim(),
    huggingFaceToken: huggingFaceReadToken(environment),
    releaseAlertCountries: new Set(
      selectableCountries().filter((country) => hasReleaseAlertChannel(country, environment)),
    ),
    githubRepository:
      environment.CALIBRATION_TREE_GITHUB_REPOSITORY?.trim() ||
      "PolicyEngine/calibration-diagnostics",
    githubWorkflow:
      environment.CALIBRATION_TREE_GITHUB_WORKFLOW?.trim() ||
      "publish-calibration-tree.yml",
    repositories,
    treeBuildCollector: treeBuildCollectorAddress(
      environment.MICROCOSM_TELEMETRY_COLLECTOR_URL,
    ),
  };
}

function treeBuildCollectorAddress(
  value: string | undefined,
): TreeBuildCollectorAddress | undefined {
  const rawUrl = value?.trim();
  if (!rawUrl) return undefined;
  try {
    return { baseUrl: telemetryCollectorBaseUrl(rawUrl) };
  } catch (error) {
    // The rule's own errors are fixed sentences. The TypeError of `new URL`
    // can repeat the value, so it is replaced by one.
    return {
      problem:
        error instanceof TypeError || !(error instanceof Error)
          ? "Telemetry collector URL is not a valid URL."
          : error.message,
    };
  }
}

export function loadHfWebhookConfig(): HfWebhookConfig {
  return resolveHfWebhookConfig(process.env);
}
