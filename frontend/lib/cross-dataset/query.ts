import { ArtifactError, CrossDatasetArtifactReader } from "./artifact";
import type { FactSort } from "./artifact";

export interface ApiResponse {
  status: number;
  body: unknown;
}

function clientError(detail: string, status = 400): ApiResponse {
  return { status, body: { detail } };
}

function positiveInteger(value: string | null, fallback: number): number | null {
  if (value == null || value === "") return fallback;
  if (!/^\d+$/.test(value)) return null;
  const result = Number(value);
  return Number.isSafeInteger(result) && result > 0 ? result : null;
}

export async function crossDatasetApiResponse(
  requestUrl: string,
  reader: CrossDatasetArtifactReader,
): Promise<ApiResponse> {
  const params = new URL(requestUrl).searchParams;
  const view = params.get("view") || "summary";
  try {
    if (view === "summary") return { status: 200, body: await reader.summary() };
    if (view === "groups") {
      return {
        status: 200,
        body: await reader.groups({
          dimension: params.get("dimension") || undefined,
          source: params.get("source") || undefined,
        }),
      };
    }
    if (view === "source") {
      const sourceId = params.get("source")?.trim();
      if (!sourceId) return clientError("Provide a source via ?source=.");
      const source = await reader.source(sourceId);
      return source ? { status: 200, body: source } : clientError(`Unknown source ${sourceId}.`, 404);
    }
    if (view === "facts") {
      const page = positiveInteger(params.get("page"), 1);
      const pageSize = positiveInteger(params.get("page_size"), 100);
      if (page == null) return clientError("page must be a positive integer.");
      if (pageSize == null || pageSize > 250) {
        return clientError("page_size must be between 1 and 250.");
      }
      const sort = params.get("sort") || "fact_key";
      if (!["fact_key", "label", "error_desc"].includes(sort)) {
        return clientError("sort must be fact_key, label, or error_desc.");
      }
      if (sort === "error_desc" && !params.get("source")) {
        return clientError("error_desc sorting requires ?source=.");
      }
      if (
        (params.get("status") || params.get("period_treatment") || params.get("calibration_exposure")) &&
        !params.get("source")
      ) {
        return clientError(
          "Filtering by status, period_treatment, or calibration_exposure also requires ?source=.",
        );
      }
      return {
        status: 200,
        body: await reader.facts({
          page,
          pageSize,
          source: params.get("source") || undefined,
          status: params.get("status") || undefined,
          chronicleSource: params.get("ledger_source") || undefined,
          measure: params.get("measure") || undefined,
          period: params.get("period") || undefined,
          geography: params.get("geography") || undefined,
          periodTreatment: params.get("period_treatment") || undefined,
          calibrationExposure: params.get("calibration_exposure") || undefined,
          search: params.get("search") || undefined,
          sort: sort as FactSort,
        }),
      };
    }
    if (view === "fact") {
      const factKey = params.get("fact_key")?.trim();
      if (!factKey) return clientError("Provide a fact via ?fact_key=.");
      const fact = await reader.fact(factKey);
      return fact ? { status: 200, body: { fact } } : clientError(`Unknown fact ${factKey}.`, 404);
    }
    return clientError(`Unknown Cross-dataset view ${view}.`);
  } catch (error) {
    if (error instanceof RangeError) return clientError(error.message);
    if (error instanceof ArtifactError) {
      return {
        status: 503,
        body: { detail: error.message, artifact_error: error.code },
      };
    }
    throw error;
  }
}
