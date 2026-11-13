import { timingSafeEqual } from "node:crypto";

import { getVercelOidcToken } from "@vercel/oidc";
import { NextResponse } from "next/server";

import { postReleaseAlert, postReleaseRecordAlert } from "@/lib/slack";

import type { MicrocosmCountry } from "@policyengine/calibration-tree/countries";
import {
  RELEASES_RECORD_PATH,
  parseReleasesRecordBytes,
  releasesRecordFromResponse,
  type ReleasesRecord,
} from "@policyengine/calibration-tree/release-record";
import type {
  HfWebhookConfig,
  TreeBuildCollectorAddress,
  WebhookRepositoryRegistration,
} from "./hf-webhook-config";
import {
  releaseRecordAlerts,
  unannouncedRecordChanges,
  type ReleaseRecordAlert,
  type UnannouncedRecordChange,
} from "./release-record-alerts";

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
  /**
   * GitHub dispatches, Hugging Face reads of releases.json and the
   * collector's calibration-tree build requests.
   */
  fetch: FetchImplementation;
  postReleaseAlert: typeof postReleaseAlert;
  postReleaseRecordAlert: typeof postReleaseRecordAlert;
  /**
   * The deployment's Vercel OIDC token, which the collector checks. Called
   * inside the request handler for each collector request, never when the
   * handler is created; getVercelOidcToken (@vercel/oidc) unless given.
   */
  vercelOidcToken: () => Promise<string>;
}

/**
 * The body of the collector's POST /v1/calibration-tree-builds
 * (microcosm-collector#66, TreeBuildRequestBody).
 */
interface TreeBuildRequestBody {
  country: MicrocosmCountry;
  kind: WebhookRepositoryRegistration["kind"];
  hf_repo: string;
  hf_ref?: string;
  hf_commit?: string;
}

/** The answer's tree_build: what became of the collector request. */
type TreeBuildOutcome =
  | { status: "queued" | "already_queued"; task_id: string; not_before: string }
  | { status: "failed"; detail: string }
  | { status: "not_configured" };

const COMMIT_SHA = /^[0-9a-f]{40}$/;
const TREE_BUILDS_PATH = "/v1/calibration-tree-builds";
// The collector's pattern for hf_ref. It only records hf_ref and hf_commit,
// and refuses the whole request when either breaks its pattern (COMMIT_SHA
// for hf_commit), so a value that does is left out instead.
const COLLECTOR_HF_REF = /^refs\/(heads|tags)\/[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/;
const COLLECTOR_TIMEOUT_DETAIL = "The collector did not answer within 15 seconds.";
const REPOSITORY_NAME = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

/**
 * A failure that a later attempt may not repeat: Hugging Face answered 5xx
 * or 429, or the request or a 200's body failed or timed out. The webhook
 * answers 503 for it, before dispatching or posting anything, so Hugging
 * Face's retry of the delivery does each of them once.
 */
class TransientRecordReadError extends Error {}

/**
 * The repository's releases.json at a commit, or null when it has none there
 * (Hugging Face's 404 for the file). Throws TransientRecordReadError for a
 * failure worth retrying, and another error when the record cannot be read
 * for a lasting reason or the release writer's rules refuse it
 * (releasesRecordFromResponse).
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
  let response: Response;
  let body: ArrayBuffer | null = null;
  // The request and, for a 200, its body: the 15-second timeout covers both,
  // and a failure in either may pass.
  try {
    response = await fetchImplementation(
      `https://huggingface.co/datasets/${repo}/resolve/${commitSha}/${RELEASES_RECORD_PATH}`,
      {
        headers: config.huggingFaceToken
          ? { Authorization: `Bearer ${config.huggingFaceToken}` }
          : {},
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (response.ok) body = await response.arrayBuffer();
  } catch (error) {
    throw new TransientRecordReadError(
      `Reading ${RELEASES_RECORD_PATH} at ${commitSha} failed: ` +
        `${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (response.status >= 500 || response.status === 429) {
    throw new TransientRecordReadError(
      `Hugging Face returned ${response.status} for ${RELEASES_RECORD_PATH} at ${commitSha}.`,
    );
  }
  // A 404 is "no record" or a lasting failure; any other status is lasting.
  if (!body) return releasesRecordFromResponse(response);
  return parseReleasesRecordBytes(new Uint8Array(body));
}

type RecordComparison =
  | { kind: "compared"; alerts: ReleaseRecordAlert[]; unannounced: UnannouncedRecordChange[] }
  | { kind: "unavailable"; problem: string }
  | { kind: "retry"; reason: string };

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * What one update of a release repository's main changed in releases.json.
 * Both reads are settled before deciding. A lasting failure on either side
 * (a record that cannot be read for a lasting reason or is refused) decides:
 * it is logged, gives no alerts and is named in the answer. Otherwise a
 * transient failure on either side asks for a retry.
 */
async function compareReleaseRecords(
  repo: string,
  update: UpdatedRef,
  config: HfWebhookConfig,
  fetchImplementation: FetchImplementation,
): Promise<RecordComparison> {
  const span = `${update.oldSha ?? "none"} to ${update.newSha ?? "none"}`;
  const [before, after] = await Promise.allSettled([
    readReleasesRecordAt(repo, update.oldSha, config, fetchImplementation),
    readReleasesRecordAt(repo, update.newSha, config, fetchImplementation),
  ]);
  const failures = [before, after].flatMap((side) => (side.status === "rejected" ? [side.reason] : []));
  // A lasting failure on either side decides: a retry cannot make that side
  // readable, so the update gets no record alerts either way.
  const lasting = failures.find((reason) => !(reason instanceof TransientRecordReadError));
  if (lasting !== undefined) {
    console.error(`No ${RELEASES_RECORD_PATH} alerts for ${repo} (${span}):`, lasting);
    return { kind: "unavailable", problem: errorMessage(lasting) };
  }
  if (failures.length > 0) {
    const reason = failures.map(errorMessage).join(" ");
    console.error(
      `${RELEASES_RECORD_PATH} of ${repo} (${span}) could not be read; ` +
        "answering 503 so that Hugging Face retries the delivery:",
      reason,
    );
    return { kind: "retry", reason };
  }
  const beforeRecord = before.status === "fulfilled" ? before.value : null;
  const afterRecord = after.status === "fulfilled" ? after.value : null;
  return {
    kind: "compared",
    alerts: releaseRecordAlerts(beforeRecord, afterRecord),
    unannounced: unannouncedRecordChanges(beforeRecord, afterRecord),
  };
}

function logUnannounced(repo: string, update: UpdatedRef, change: UnannouncedRecordChange) {
  const span = `${update.oldSha ?? "none"} to ${update.newSha ?? "none"}`;
  const what = change.kind === "removed"
    ? `${RELEASES_RECORD_PATH} was removed from ${repo}; its readers now read tags and pointer files`
    : change.kind === "default_changed"
      ? `in ${repo}, the default release changed from ${change.from ?? "none"} to ${change.to ?? "none"}`
      : `in ${repo}, ${change.release}/${change.build} is no longer withdrawn`;
  console.warn(`${what} (${span}). No Slack alert is posted for this change.`);
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

function treeBuildRequestBody(
  registration: WebhookRepositoryRegistration,
  trigger: UpdatedRef,
): TreeBuildRequestBody {
  return {
    country: registration.country,
    kind: registration.kind,
    // As configured: the delivery's spelling may differ in letter case, and
    // the collector compares names exactly.
    hf_repo: registration.repo,
    ...(COLLECTOR_HF_REF.test(trigger.ref) ? { hf_ref: trigger.ref } : {}),
    ...(trigger.newSha && COMMIT_SHA.test(trigger.newSha)
      ? { hf_commit: trigger.newSha }
      : {}),
  };
}

/**
 * Logs a failed collector request and gives its tree_build. `detail` is a
 * fixed sentence for the answer; only the log carries the cause, which never
 * includes the token.
 */
function failedTreeBuild(detail: string, cause: string): TreeBuildOutcome {
  console.error(`Calibration tree build request to the collector failed: ${cause}`);
  return { status: "failed", detail };
}

const isTimeout = (error: unknown) =>
  typeof error === "object" &&
  error !== null &&
  (error as { name?: unknown }).name === "TimeoutError";

/** The tree_build of the collector's 202 answer, or null when it is not one. */
function queuedTreeBuild(text: string): TreeBuildOutcome | null {
  let answer: unknown;
  try {
    answer = JSON.parse(text);
  } catch {
    return null;
  }
  if (!answer || typeof answer !== "object" || Array.isArray(answer)) return null;
  const { status, task_id: taskId, not_before: notBefore } = answer as Record<string, unknown>;
  if (status !== "queued" && status !== "already_queued") return null;
  if (typeof taskId !== "string" || !taskId) return null;
  if (typeof notBefore !== "string" || !notBefore) return null;
  return { status, task_id: taskId, not_before: notBefore };
}

/** A promise that rejects with the signal's reason once it aborts. */
function rejectionOnAbort(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    if (signal.aborted) reject(signal.reason);
    else signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
}

/**
 * Asks the collector to queue a calibration-tree build of the delivery's
 * country and kind, with the deployment's Vercel OIDC token, read for this
 * request. One 15-second deadline covers the token read, the request and its
 * answer, so a token read that never settles holds the webhook's answer no
 * longer than a slow collector would.
 * Never throws: a request that cannot be sent or is not answered 202 is
 * logged and gives a failed tree_build.
 */
async function requestTreeBuild(
  body: TreeBuildRequestBody,
  collector: TreeBuildCollectorAddress | undefined,
  readVercelOidcToken: () => Promise<string>,
  fetchImplementation: FetchImplementation,
): Promise<TreeBuildOutcome> {
  if (!collector) return { status: "not_configured" };
  if ("problem" in collector) {
    return failedTreeBuild(
      "MICROCOSM_TELEMETRY_COLLECTOR_URL is invalid.",
      `MICROCOSM_TELEMETRY_COLLECTOR_URL is invalid, so no request was sent: ${collector.problem}`,
    );
  }
  const deadline = AbortSignal.timeout(15_000);
  const tokenDetail = "The Vercel OIDC token could not be read.";
  let token: string;
  try {
    token = await Promise.race([readVercelOidcToken(), rejectionOnAbort(deadline)]);
  } catch (error) {
    return failedTreeBuild(
      tokenDetail,
      `the Vercel OIDC token could not be read, so no request was sent: ${errorMessage(error)}`,
    );
  }
  if (!token) {
    return failedTreeBuild(tokenDetail, "the Vercel OIDC token is empty, so no request was sent.");
  }
  let response: Response;
  try {
    response = await fetchImplementation(`${collector.baseUrl}${TREE_BUILDS_PATH}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: deadline,
    });
  } catch (error) {
    return failedTreeBuild(
      isTimeout(error) ? COLLECTOR_TIMEOUT_DETAIL : "The collector could not be reached.",
      errorMessage(error),
    );
  }
  // The deadline also covers the answer's body.
  let text: string;
  try {
    text = await response.text();
  } catch (error) {
    return failedTreeBuild(
      isTimeout(error)
        ? COLLECTOR_TIMEOUT_DETAIL
        : `The collector's HTTP ${response.status} answer could not be read.`,
      `the collector's ${response.status} answer could not be read: ${errorMessage(error)}`,
    );
  }
  if (response.status !== 202) {
    return failedTreeBuild(
      `The collector answered HTTP ${response.status}.`,
      `the collector answered ${response.status}: ${text.slice(0, 200)}`,
    );
  }
  return (
    queuedTreeBuild(text) ??
    failedTreeBuild(
      "The collector's HTTP 202 answer is not a queued build.",
      `the collector's 202 answer is not a queued build: ${text.slice(0, 200)}`,
    )
  );
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
  const readVercelOidcToken =
    dependencies.vercelOidcToken ?? (() => getVercelOidcToken());

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
    // The update that starts this delivery's calibration-tree builds, the
    // GitHub dispatch and the collector request: a staging repository's last
    // main update; a release repository's newest new tag, else its last main
    // update. Without one, the delivery starts neither.
    const mainUpdate = mainUpdates.at(-1);
    const tagUpdate = registration.kind === "release" ? newTagRefs.at(-1) : undefined;
    const trigger = registration.kind === "staging" ? mainUpdate : tagUpdate ?? mainUpdate;
    const dispatches: TreeBuildDispatch[] = trigger
      ? [
          {
            country,
            eventKind: registration.kind === "staging" ? "staging" : tagUpdate ? "tag" : "branch",
            ...(tagUpdate ? { releaseId: tagUpdate.ref.slice(TAG_PREFIX.length) } : {}),
            hfCommitSha: trigger.newSha!,
          },
        ]
      : [];

    // releases.json is read before anything is dispatched or posted. A
    // transient failure then answers 503 with nothing done, and Hugging
    // Face's retry of the delivery does everything once.
    // Only a release repository whose country has a Slack channel can get
    // record alerts, so only its record is read and only it risks a 503.
    const comparison =
      registration.kind === "release" && mainUpdate && config.releaseAlertCountries.has(country)
        ? await compareReleaseRecords(repo, mainUpdate, config, fetchImplementation)
        : null;
    if (comparison?.kind === "retry") {
      return NextResponse.json(
        { detail: `Unable to read ${RELEASES_RECORD_PATH}; retry the delivery.` },
        { status: 503 },
      );
    }

    // The GitHub dispatch and the collector's calibration-tree build request
    // run at the same time, each with its own 15-second timeout, and neither
    // failing stops the other. The dispatch alone decides the answer's status;
    // the collector request's outcome is reported as tree_build.
    const [dispatched, treeBuildRequested] = await Promise.allSettled([
      (async () => {
        for (const dispatch of dispatches) {
          await dispatchTreeBuild(dispatch, config, fetchImplementation);
        }
      })(),
      trigger
        ? requestTreeBuild(
            treeBuildRequestBody(registration, trigger),
            config.treeBuildCollector,
            readVercelOidcToken,
            fetchImplementation,
          )
        : Promise.resolve(null),
    ]);
    const treeBuild =
      treeBuildRequested.status === "fulfilled"
        ? treeBuildRequested.value
        : failedTreeBuild(
            "The collector request failed.",
            errorMessage(treeBuildRequested.reason),
          );
    // A delivery that starts no build answers as before, without tree_build.
    const treeBuildAnswer = treeBuild ? { tree_build: treeBuild } : {};
    if (dispatched.status === "rejected") {
      console.error("Calibration tree workflow dispatch failed:", dispatched.reason);
      return NextResponse.json(
        { detail: "Unable to start calibration tree publication.", ...treeBuildAnswer },
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
    if (comparison && mainUpdate) {
      const posted: string[] = [];
      const alerts = comparison.kind === "compared" ? comparison.alerts : [];
      for (const change of comparison.kind === "compared" ? comparison.unannounced : []) {
        logUnannounced(repo, mainUpdate, change);
      }
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
      ...treeBuildAnswer,
      alerted,
      ...(recordAlerted ? { release_record_alerted: recordAlerted } : {}),
      // A record that could not be read for a lasting reason, so that the
      // answer tells it apart from a record that did not change.
      ...(comparison?.kind === "unavailable" ? { release_record_problem: comparison.problem } : {}),
    });
  };
}
