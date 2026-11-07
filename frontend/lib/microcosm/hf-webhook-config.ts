import {
  resolveRegisteredRepository,
  resolveRegisteredStagingRepository,
  selectableCountries,
  type MicrocosmCountry,
  type RepositoryEnvironment,
} from "@policyengine/calibration-tree/countries";
import { huggingFaceReadToken } from "@policyengine/calibration-tree/latest-artifact";

import { hasReleaseAlertChannel } from "@/lib/slack";

export interface WebhookRepositoryRegistration {
  country: MicrocosmCountry;
  kind: "release" | "staging";
}

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
   * SLACK_WEBHOOK_MICROCOSM_* variable takes effect with the next deployment.
   * Only their release repositories' releases.json is read for alerts, so
   * only they can be answered 503 when the read fails.
   */
  releaseAlertCountries: ReadonlySet<MicrocosmCountry>;
  githubRepository: string;
  githubWorkflow: string;
  repositories: ReadonlyMap<string, WebhookRepositoryRegistration>;
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
    });

    const stagingRepository = resolveRegisteredStagingRepository(
      country,
      environment,
    );
    if (stagingRepository) {
      repositories.set(stagingRepository.repo.toLowerCase(), {
        country,
        kind: "staging",
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
  };
}

export function loadHfWebhookConfig(): HfWebhookConfig {
  return resolveHfWebhookConfig(process.env);
}
