import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import { postReleaseAlert, postReleaseRecordAlert } from "@/lib/slack";

import type { MicrocosmCountry } from "@policyengine/calibration-tree/countries";
import {
  RELEASES_RECORD_PATH,
  releasesRecordFromResponse,
  type ReleasesRecord,
} from "@policyengine/calibration-tree/release-record";
import type { HfWebhookConfig } from "./hf-webhook-config";
import { releaseRecordAlerts, type ReleaseRecordAlert } from "./release-record-alerts";

interface UpdatedRef {
  ref: string;
  oldSha: string | null;
  newSha: string | null;
}

interface WebhookPayload {
  repo?: { name?: string };
  updatedRefs?: UpdatedRef[];
}

interface TreeBuildDispatch {
  country: MicrocosmCountry;
  eventKind: "tag" | "branch" | "staging";
  releaseId?: string;
  hfCommitSha: string;
}

type FetchImplementation = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface HfWebhookHandlerDependencies {
  /** GitHub dispatches and Hugging Face reads of releases.json. */
  fetch: FetchImplementation;
  postReleaseAlert: typeof postReleaseAlert;
  postReleaseRecordAlert: typeof postReleaseRecordAlert;
}

const COMMIT_SHA = /^[0-9a-f]{40}$/;
const REPOSITORY_NAME = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

/**
 * The repository's releases.json at a commit, or null when it has none there
 * (Hugging Face's 404 for the file). Throws when it cannot be read or the
 * release writer's rules refuse it (releasesRecordFromResponse).
 */
async function readReleasesRecordAt(
  repo: string,
  commitSha: string | null,
  config: HfWebhookConfig,
  fetchImplementation: FetchImplementation,
): Promise<ReleasesRecord | null> {
  if (commitSha == null) return null;
  if (!REPOSITORY_NAME.test(repo) || !COMMIT_SHA.test(commitSha)) {
    throw new Error(`Cannot read ${RELEASES_RECORD_PATH} of ${repo} at ${commitSha}.`);
  }
  const response = await fetchImplementation(
    `https://huggingface.co/datasets/${repo}/resolve/${commitSha}/${RELEASES_RECORD_PATH}`,
    {
      headers: config.huggingFaceToken
        ? { Authorization: `Bearer ${config.huggingFaceToken}` }
        : {},
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    },
  );
  return releasesRecordFromResponse(response);
}

/**
 * What one update of a release repository's main changed in releases.json.
 * A record that cannot be read or is refused, before or after the update, is
 * logged and gives no alerts.
 */
async function releaseRecordAlertsForUpdate(
  repo: string,
  update: UpdatedRef,
  config: HfWebhookConfig,
  fetchImplementation: FetchImplementation,
): Promise<ReleaseRecordAlert[]> {
  try {
    const [before, after] = await Promise.all([
      readReleasesRecordAt(repo, update.oldSha, config, fetchImplementation),
      readReleasesRecordAt(repo, update.newSha, config, fetchImplementation),
    ]);
    return releaseRecordAlerts(before, after);
  } catch (error) {
    console.error(
      `No ${RELEASES_RECORD_PATH} alerts for ${repo} ` +
        `(${update.oldSha ?? "none"} to ${update.newSha ?? "none"}):`,
      error,
    );
    return [];
  }
}

function describeAlert(alert: ReleaseRecordAlert): string {
  switch (alert.kind) {
    case "published":
    case "withdrawn":
      return `${alert.kind} ${alert.release}/${alert.build}`;
    case "current_changed":
      return `current ${alert.release}: ${alert.from ?? "none"} to ${alert.to ?? "none"}`;
    case "record_created":
      return `created ${RELEASES_RECORD_PATH}`;
  }
}

const TAG_PREFIX = "refs/tags/";
const MAIN_BRANCH_REF = "refs/heads/main";

function secretOk(request: Request, expected: string | undefined): boolean {
  if (!expected) return false;
  const provided =
    request.headers.get("x-webhook-secret") ??
    new URL(request.url).searchParams.get("secret") ??
    "";
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function dispatchTreeBuild(
  input: TreeBuildDispatch,
  config: HfWebhookConfig,
  fetchImplementation: FetchImplementation,
): Promise<void> {
  if (!config.githubToken) {
    throw new Error("GITHUB_ACTIONS_DISPATCH_TOKEN is not configured.");
  }
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(config.githubRepository)) {
    throw new Error("CALIBRATION_TREE_GITHUB_REPOSITORY is invalid.");
  }
  const response = await fetchImplementation(
    `https://api.github.com/repos/${config.githubRepository}/actions/workflows/${encodeURIComponent(config.githubWorkflow)}/dispatches`,
    {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${config.githubToken}`,
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({
        ref: "main",
        inputs: {
          country: input.country,
          event_kind: input.eventKind,
          release_id: input.releaseId ?? "",
          hf_commit_sha: input.hfCommitSha,
        },
      }),
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (response.status !== 204) {
    const body = await response.text();
    throw new Error(
      `GitHub workflow dispatch returned ${response.status}: ${body.slice(0, 200)}`,
    );
  }
}

export function createHfWebhookHandler(
  config: HfWebhookConfig,
  dependencies: Partial<HfWebhookHandlerDependencies> = {},
) {
  const fetchImplementation =
    dependencies.fetch ??
    ((input: string | URL | Request, init?: RequestInit) =>
      globalThis.fetch(input, init));
  const sendReleaseAlert =
    dependencies.postReleaseAlert ?? postReleaseAlert;
  const sendReleaseRecordAlert =
    dependencies.postReleaseRecordAlert ?? postReleaseRecordAlert;

  return async function handleHfWebhook(request: Request) {
    if (!secretOk(request, config.secret)) {
      return NextResponse.json(
        { detail: "Invalid webhook secret" },
        { status: 401 },
      );
    }

    let payload: WebhookPayload;
    try {
      payload = (await request.json()) as WebhookPayload;
    } catch {
      return NextResponse.json({ detail: "Invalid JSON" }, { status: 400 });
    }

    const repo = payload.repo?.name ?? "";
    const registration = config.repositories.get(repo.toLowerCase()) ?? null;
    const updatedRefs = payload.updatedRefs ?? [];
    const newTagRefs = updatedRefs.filter(
      (updatedRef) =>
        updatedRef.ref?.startsWith(TAG_PREFIX) &&
        updatedRef.oldSha == null &&
        updatedRef.newSha,
    );
    const newTags = newTagRefs
      .map((updatedRef) => updatedRef.ref.slice(TAG_PREFIX.length))
      .filter(Boolean);
    const mainUpdates = updatedRefs.filter(
      (updatedRef) =>
        updatedRef.ref === MAIN_BRANCH_REF && Boolean(updatedRef.newSha),
    );

    if (!registration || (newTags.length === 0 && mainUpdates.length === 0)) {
      return NextResponse.json({ ok: true, dispatched: [], alerted: [] });
    }

    const { country } = registration;
    const dispatches: TreeBuildDispatch[] = registration.kind === "staging"
      ? mainUpdates.slice(-1).map((updatedRef) => ({
          country,
          eventKind: "staging" as const,
          hfCommitSha: updatedRef.newSha!,
        }))
      : (() => {
          const tagUpdate = newTagRefs.at(-1);
          const mainUpdate = mainUpdates.at(-1);
          const trigger = tagUpdate ?? mainUpdate;
          if (!trigger) return [];
          return [
            {
              country,
              eventKind: tagUpdate ? ("tag" as const) : ("branch" as const),
              ...(tagUpdate
                ? { releaseId: tagUpdate.ref.slice(TAG_PREFIX.length) }
                : {}),
              hfCommitSha: trigger.newSha!,
            },
          ];
        })();

    try {
      for (const dispatch of dispatches) {
        await dispatchTreeBuild(dispatch, config, fetchImplementation);
      }
    } catch (error) {
      console.error("Calibration tree workflow dispatch failed:", error);
      return NextResponse.json(
        { detail: "Unable to start calibration tree publication." },
        { status: 502 },
      );
    }

    const alerted: string[] = [];
    for (const releaseId of registration.kind === "release" ? newTags : []) {
      try {
        const sent = await sendReleaseAlert({ country, releaseId, repo });
        if (sent) alerted.push(releaseId);
      } catch (error) {
        console.error(`Slack alert failed for ${releaseId}:`, error);
      }
    }

    // A release repository with releases.json publishes builds without tags:
    // its alerts come from comparing the record before and after the update.
    // A repository without releases.json reads as having none on both sides
    // and gets none, so its tag alerts above are its only ones.
    // Named in the answer only when releases.json was read, so a delivery
    // without a main update answers as before.
    let recordAlerted: string[] | null = null;
    const mainUpdate = mainUpdates.at(-1);
    if (registration.kind === "release" && mainUpdate) {
      const posted: string[] = [];
      const alerts = await releaseRecordAlertsForUpdate(
        repo,
        mainUpdate,
        config,
        fetchImplementation,
      );
      for (const alert of alerts) {
        try {
          const sent = await sendReleaseRecordAlert({ country, repo, alert });
          if (sent) posted.push(describeAlert(alert));
        } catch (error) {
          console.error(`Slack alert failed for ${describeAlert(alert)}:`, error);
        }
      }
      recordAlerted = posted;
    }

    return NextResponse.json({
      ok: true,
      country,
      dispatched: dispatches.map((dispatch) => ({
        event_kind: dispatch.eventKind,
        release_id: dispatch.releaseId ?? null,
        hf_commit_sha: dispatch.hfCommitSha,
      })),
      alerted,
      ...(recordAlerted ? { release_record_alerted: recordAlerted } : {}),
    });
  };
}
