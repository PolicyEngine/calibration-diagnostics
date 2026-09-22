import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import { postReleaseAlert } from "@/lib/slack";

import type { MicrocosmCountry } from "./countries";
import type { HfWebhookConfig } from "./hf-webhook-config";

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
  fetch: FetchImplementation;
  postReleaseAlert: typeof postReleaseAlert;
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

    return NextResponse.json({
      ok: true,
      country,
      dispatched: dispatches.map((dispatch) => ({
        event_kind: dispatch.eventKind,
        release_id: dispatch.releaseId ?? null,
        hf_commit_sha: dispatch.hfCommitSha,
      })),
      alerted,
    });
  };
}
