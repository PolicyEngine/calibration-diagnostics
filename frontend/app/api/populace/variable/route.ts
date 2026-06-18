import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

import { NextResponse } from "next/server";

import {
  POPULACE_HF_REPO,
  loadPointerReleaseId,
  scrub,
} from "@/lib/populace/latest-artifact";

const execFileAsync = promisify(execFile);

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

const VARIABLE_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

function errorResponse(detail: string, status: number) {
  return NextResponse.json({ detail }, { status });
}

function friendlyErrorDetail(detail: string, fallback = "Variable calculation failed.") {
  const trimmed = detail.trim();
  if (!trimmed) return fallback;
  if (
    trimmed.startsWith("<!DOCTYPE html") ||
    trimmed.startsWith("<html") ||
    trimmed.includes("__next_error__")
  ) {
    return "Variable calculation failed in the hosted Python runtime. Please retry; if it persists, check the Vercel function logs.";
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

function hostedPythonFunctionUrl(
  request: Request,
  variables: string[],
  period: string,
  release: string,
) {
  const incomingUrl = new URL(request.url);
  const endpoint = new URL("/api/populace_variable", incomingUrl.origin);
  endpoint.searchParams.set("period", period);
  endpoint.searchParams.set("release", release);
  variables.forEach((variable) => endpoint.searchParams.append("variables", variable));
  endpoint.searchParams.set("_", String(Date.now()));
  return endpoint;
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
  const variables = [
    ...url.searchParams.getAll("variables"),
    ...url.searchParams.getAll("variable"),
  ]
    .flatMap((value) => value.split(/[,\s]+/))
    .map((value) => value.trim())
    .filter(Boolean);
  const uniqueVariables = [...new Set(variables)];
  const period = url.searchParams.get("period")?.trim() || "2024";
  const requestedRelease = url.searchParams.get("release")?.trim() || "latest";

  if (!uniqueVariables.length) {
    return errorResponse("Enter at least one PolicyEngine variable name.", 400);
  }
  if (uniqueVariables.length > 12) {
    return errorResponse("Run at most 12 variables at a time.", 400);
  }
  const invalid = uniqueVariables.find((variable) => !VARIABLE_RE.test(variable));
  if (invalid) {
    return errorResponse(`Invalid PolicyEngine variable name: ${invalid}`, 400);
  }
  if (!/^\d{4}$/.test(period)) {
    return errorResponse("Period must be a four-digit year.", 400);
  }

  try {
    const release =
      requestedRelease === "latest"
        ? (await loadPointerReleaseId(300)).release_id
        : requestedRelease;
    if (process.env.VERCEL === "1" && !process.env.PYTHON) {
      return NextResponse.redirect(
        hostedPythonFunctionUrl(request, uniqueVariables, period, release),
        307,
      );
    }
    const scriptPath = path.join(process.cwd(), "scripts", "populace_variable_value.py");
    const variableArgs = uniqueVariables.flatMap((variable) => ["--variable", variable]);
    const { stdout } = await runVariableScript(
      scriptPath,
      [
        ...variableArgs,
        "--period",
        period,
        "--repo",
        POPULACE_HF_REPO,
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
    const err = error as Error & { stderr?: string; signal?: string; status?: number };
    let detail = err.stderr || err.message || "Variable calculation failed.";
    try {
      const parsed = JSON.parse(err.stderr ?? "");
      if (typeof parsed.detail === "string") detail = parsed.detail;
    } catch {
      // Keep the raw stderr/message.
    }
    if (err.signal === "SIGTERM") {
      detail = "Variable calculation timed out.";
    }
    return errorResponse(friendlyErrorDetail(detail), err.status ?? 502);
  }
}
