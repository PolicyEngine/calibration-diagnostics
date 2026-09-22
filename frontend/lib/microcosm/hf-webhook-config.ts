import {
  resolveRegisteredRepository,
  resolveRegisteredStagingRepository,
  selectableCountries,
  type MicrocosmCountry,
  type RepositoryEnvironment,
} from "./countries";

export interface WebhookRepositoryRegistration {
  country: MicrocosmCountry;
  kind: "release" | "staging";
}

export interface HfWebhookConfig {
  secret: string | undefined;
  githubToken: string | undefined;
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
