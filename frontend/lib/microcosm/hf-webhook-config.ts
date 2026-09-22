import {
  countryRegistration,
  hasCapability,
  selectableCountries,
  type MicrocosmCountry,
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

export type HfWebhookEnvironment = Readonly<
  Record<string, string | undefined>
>;

function configuredValue(
  environment: HfWebhookEnvironment,
  variableName: string | undefined,
  fallback: string,
): string {
  return (variableName ? environment[variableName] : undefined) ?? fallback;
}

export function resolveHfWebhookConfig(
  environment: HfWebhookEnvironment,
): HfWebhookConfig {
  const repositories = new Map<string, WebhookRepositoryRegistration>();

  for (const country of selectableCountries()) {
    const registration = countryRegistration(country);
    const releaseRepository = configuredValue(
      environment,
      registration.repo_env,
      registration.repo,
    );
    repositories.set(releaseRepository.toLowerCase(), {
      country,
      kind: "release",
    });

    if (hasCapability(country, "staging") && registration.staging) {
      const stagingRepository = configuredValue(
        environment,
        registration.staging.repo_env,
        registration.staging.repo,
      );
      repositories.set(stagingRepository.toLowerCase(), {
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
