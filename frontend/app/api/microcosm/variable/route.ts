import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

import { NextResponse } from "next/server";

import { MICROCOSM_HF_REPO, scrub } from "@/lib/microcosm/latest-artifact";
import {
  HOSTED_US_RELEASE,
  reviewedVariableRelease,
} from "@/lib/microcosm/production-release";

import { proxyVariableBackend } from "@/lib/api/variable-backend";

const execFileAsync = promisify(execFile);

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 800;

const VARIABLE_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

function errorResponse(detail: string, status: number) {
  return NextResponse.json({ detail }, { status });
}

function friendlyErrorDetail(
  detail: string,
  fallback = "Variable calculation failed.",
) {
  const trimmed = detail.trim();
  if (!trimmed) return fallback;
  if (
    trimmed.startsWith("<!DOCTYPE html") ||
    trimmed.startsWith("<html") ||
    trimmed.includes("__next_error__")
  ) {
    return "Variable calculation failed in the Python runtime.";
  }
  return trimmed.length > 600 ? `${trimmed.slice(0, 600)}...` : trimmed;
}

function hostedPythonUnavailableError() {
  return Object.assign(
    new Error(
      "Variable lookup is not available on the hosted deployment because the Vercel Node runtime cannot run the PolicyEngine Python calculation environment. Use the local app for now, or move this endpoint to a Python-backed service.",
    ),
    { status: 503 },
  );
}

async function runVariableScript(
  scriptPath: string,
  args: string[],
  env: NodeJS.ProcessEnv,
) {
  const pythonCandidates = process.env.PYTHON
    ? [process.env.PYTHON]
    : ["python", "python3"];

  let lastError: (Error & { code?: string; stderr?: string }) | null = null;
  for (const python of pythonCandidates) {
    try {
      return await execFileAsync(python, [scriptPath, ...args], {
        timeout: 5 * 60 * 1000,
        maxBuffer: 1024 * 1024,
        env,
      });
    } catch (error) {
      const err = error as Error & { code?: string; stderr?: string };
      lastError = err;
      if (err.code !== "ENOENT") throw err;
    }
  }
  if (lastError?.code === "ENOENT") throw hostedPythonUnavailableError();
  throw lastError ?? hostedPythonUnavailableError();
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const useBackend =
    process.env.VERCEL === "1" || !!process.env.MICROCOSM_CALCULATION_URL;
  const backend = {
    url: process.env.MICROCOSM_CALCULATION_URL,
    key: process.env.MICROCOSM_MODAL_KEY,
    secret: process.env.MICROCOSM_MODAL_SECRET,
    sourceCommit:
      process.env.VERCEL_GIT_COMMIT_SHA ||
      process.env.MICROCOSM_BACKEND_SOURCE_COMMIT,
  };
  if (url.searchParams.get("metadata") === "1") {
    return proxyVariableBackend("metadata=1", backend);
  }
  const variables = [
    ...url.searchParams.getAll("variables"),
    ...url.searchParams.getAll("variable"),
  ]
    .flatMap((value) => value.split(/[,\s]+/))
    .map((value) => value.trim())
    .filter(Boolean);
  const uniqueVariables = [...new Set(variables)];
  const period = url.searchParams.has("period")
    ? url.searchParams.get("period")!.trim()
    : String(HOSTED_US_RELEASE.data_year);
  const requestedRelease = url.searchParams.get("release");

  if (!uniqueVariables.length) {
    return errorResponse("Enter at least one PolicyEngine variable name.", 400);
  }
  if (uniqueVariables.length > 12) {
    return errorResponse("Run at most 12 variables at a time.", 400);
  }
  const invalid = uniqueVariables.find(
    (variable) => !VARIABLE_RE.test(variable),
  );
  if (invalid) {
    return errorResponse(`Invalid PolicyEngine variable name: ${invalid}`, 400);
  }
  if (!/^\d{4}$/.test(period)) {
    return errorResponse("Period must be a four-digit year.", 400);
  }

  try {
    if (
      requestedRelease !== null &&
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(requestedRelease.trim())
    ) {
      return errorResponse("Invalid release id.", 400);
    }
    const release = reviewedVariableRelease(requestedRelease);
    if (period !== String(HOSTED_US_RELEASE.data_year)) {
      return errorResponse(
        `This production release supports period ${HOSTED_US_RELEASE.data_year}.`,
        409,
      );
    }
    if (useBackend) {
      const query = new URLSearchParams({ period, release });
      uniqueVariables.forEach((variable) =>
        query.append("variables", variable),
      );
      return proxyVariableBackend(query.toString(), backend);
    }
    const scriptPath = path.join(
      process.cwd(),
      "scripts",
      "microcosm_variable_value.py",
    );
    const variableArgs = uniqueVariables.flatMap((variable) => [
      "--variable",
      variable,
    ]);
    const { stdout } = await runVariableScript(
      scriptPath,
      [
        ...variableArgs,
        "--period",
        period,
        "--repo",
        MICROCOSM_HF_REPO,
        "--revision",
        release,
      ],
      {
        ...process.env,
        PYTHONUNBUFFERED: "1",
      },
    );
    return NextResponse.json(scrub(JSON.parse(stdout)));
  } catch (error) {
    const err = error as Error & {
      stderr?: string;
      signal?: string;
      status?: number;
    };
    let status = err.status ?? 502;
    let detail = err.stderr || err.message || "Variable calculation failed.";
    try {
      const parsed = JSON.parse(err.stderr ?? "");
      if (typeof parsed.detail === "string") detail = parsed.detail;
      if (
        Number.isInteger(parsed.status_code) &&
        parsed.status_code >= 400 &&
        parsed.status_code <= 599
      ) {
        status = parsed.status_code;
      }
    } catch {
      // Keep the raw stderr/message.
    }
    if (err.signal === "SIGTERM") {
      detail = "Variable calculation timed out.";
    }
    return errorResponse(friendlyErrorDetail(detail), status);
  }
}
