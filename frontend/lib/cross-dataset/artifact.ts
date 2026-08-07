import { createHash } from "node:crypto";

export const CROSS_DATASET_BUNDLE_SCHEMA = "cross_dataset.frontend_bundle.v1";

export type ArtifactErrorCode =
  | "malformed_artifact"
  | "partial_artifact"
  | "hash_mismatch"
  | "stale_artifact";

export class ArtifactError extends Error {
  constructor(
    public readonly code: ArtifactErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ArtifactError";
  }
}

interface PartitionDescriptor {
  path: string;
  sha256: string;
}

interface FactPartitionDescriptor extends PartitionDescriptor {
  page: number;
  count: number;
}

export interface CrossDatasetBundleManifest {
  schema_version: typeof CROSS_DATASET_BUNDLE_SCHEMA;
  run_id: string;
  snapshot_id: string;
  fact_count: number;
  source_ids: string[];
  page_size: number;
  page_count: number;
  partitions: {
    summary: PartitionDescriptor;
    groups: PartitionDescriptor;
    fact_index: PartitionDescriptor;
    facts: FactPartitionDescriptor[];
  };
}

export interface SourceScore {
  covered: number;
  scored: number;
  display_score: string | null;
  loss: string | null;
}

export interface SourceSummary {
  source_id: string;
  label: string;
  source_type: string;
  capability_count: number;
  result_count: number;
  score: SourceScore;
  capability_statuses: Record<string, number>;
  reason_codes: Record<string, number>;
  period_treatments: Record<string, number>;
  dataset_version?: string;
  model_version?: string;
}

export interface CrossDatasetSummary {
  schema_version: typeof CROSS_DATASET_BUNDLE_SCHEMA;
  run_id: string;
  snapshot_id: string;
  fact_count: number;
  matrix_complete: boolean;
  sources: SourceSummary[];
}

export interface GroupSourceSummary {
  evaluable: number;
  scored: number;
  display_score: string | null;
  loss?: string | null;
  reason_codes: Record<string, number>;
}

export interface CrossDatasetGroup {
  dimension: string;
  key: string;
  label: string;
  fact_count: number;
  sources: Record<string, GroupSourceSummary>;
}

export interface CrossDatasetGroupsDocument {
  schema_version: typeof CROSS_DATASET_BUNDLE_SCHEMA;
  run_id: string;
  snapshot_id: string;
  groups: CrossDatasetGroup[];
}

export interface FactSourceCell {
  status: string;
  reason_code?: string;
  reason_detail?: string;
  execution_method?: string;
  mapping_id?: string;
  mapping_quality?: string;
  period_treatment?: string;
  calibration_exposure?: string;
  score_eligible?: boolean;
  population_period?: string;
  policy_period?: string;
  required_variables?: string[];
  dataset_version?: string;
  model_version?: string;
  estimate?: string;
  standard_error?: string;
  margin_of_error_90?: string;
  benchmark_value?: string;
  benchmark_period?: string;
  benchmark_basis?: string;
  absolute_relative_error?: string | null;
  alignment?: Record<string, unknown>;
}

export interface CrossDatasetFact {
  fact_key: string;
  label: string;
  ledger_source: string;
  measure: string;
  unit: string;
  observed_period: string;
  observed_value: string;
  geography_level: string;
  geography_id: string;
  entity: string;
  dimensions: Record<string, unknown>;
  universe_constraints?: Record<string, unknown>[];
  provenance?: Record<string, unknown>;
  sources: Record<string, FactSourceCell>;
}

interface FactPageDocument {
  schema_version: typeof CROSS_DATASET_BUNDLE_SCHEMA;
  run_id: string;
  snapshot_id: string;
  page: number;
  page_size: number;
  total: number;
  rows: CrossDatasetFact[];
}

interface FactIndexDocument {
  schema_version: typeof CROSS_DATASET_BUNDLE_SCHEMA;
  run_id: string;
  snapshot_id: string;
  facts: Record<string, number>;
  facets: {
    ledger_source: Record<string, number[]>;
    measure: Record<string, number[]>;
    period: Record<string, number[]>;
    geography: Record<string, number[]>;
    source_status: Record<string, Record<string, number[]>>;
    source_period_treatment: Record<string, Record<string, number[]>>;
    source_calibration_exposure: Record<string, Record<string, number[]>>;
  };
}

export interface FactsQuery {
  page?: number;
  pageSize?: number;
  source?: string;
  status?: string;
  ledgerSource?: string;
  measure?: string;
  period?: string;
  geography?: string;
  periodTreatment?: string;
  calibrationExposure?: string;
  search?: string;
  sort?: FactSort;
}

export type FactSort = "fact_key" | "label" | "error_desc";

export interface FactsPage {
  schema_version: typeof CROSS_DATASET_BUNDLE_SCHEMA;
  run_id: string;
  snapshot_id: string;
  page: number;
  page_size: number;
  page_count: number;
  total: number;
  rows: CrossDatasetFact[];
}

interface ReaderOptions {
  readText: (path: string) => Promise<string>;
  expectedRunId?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value) {
    throw new ArtifactError("malformed_artifact", `Artifact field ${field} must be a non-empty string.`);
  }
  return value;
}

function requiredInteger(value: unknown, field: string, minimum = 0): number {
  if (!Number.isInteger(value) || (value as number) < minimum) {
    throw new ArtifactError("malformed_artifact", `Artifact field ${field} must be an integer >= ${minimum}.`);
  }
  return value as number;
}

function parseJson(text: string, path: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new ArtifactError("malformed_artifact", `Artifact partition ${path} is not valid JSON.`, {
      cause: error,
    });
  }
}

function validatePartition(value: unknown, field: string): PartitionDescriptor {
  if (!isRecord(value)) {
    throw new ArtifactError("malformed_artifact", `Artifact partition descriptor ${field} is missing.`);
  }
  const path = requiredString(value.path, `${field}.path`);
  const sha256 = requiredString(value.sha256, `${field}.sha256`);
  if (
    path.startsWith("/") ||
    path.includes("\\") ||
    path.split("/").some((part) => part === ".." || part === "") ||
    !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(path)
  ) {
    throw new ArtifactError("malformed_artifact", `Artifact field ${field}.path is unsafe.`);
  }
  if (!/^[a-f0-9]{64}$/.test(sha256)) {
    throw new ArtifactError("malformed_artifact", `Artifact field ${field}.sha256 is not SHA-256.`);
  }
  return { path, sha256 };
}

function validateManifest(value: unknown): CrossDatasetBundleManifest {
  if (!isRecord(value) || value.schema_version !== CROSS_DATASET_BUNDLE_SCHEMA) {
    throw new ArtifactError(
      "malformed_artifact",
      `Unsupported Cross-dataset artifact schema ${isRecord(value) ? String(value.schema_version) : "(missing)"}.`,
    );
  }
  if (!isRecord(value.partitions)) {
    throw new ArtifactError("malformed_artifact", "Cross-dataset artifact partitions are missing.");
  }
  const rawFacts = value.partitions.facts;
  if (!Array.isArray(rawFacts)) {
    throw new ArtifactError("malformed_artifact", "Cross-dataset fact partitions are missing.");
  }
  const factCount = requiredInteger(value.fact_count, "fact_count");
  const pageSize = requiredInteger(value.page_size, "page_size", 1);
  const pageCount = requiredInteger(value.page_count, "page_count");
  const facts = rawFacts.map((raw, index) => {
    const descriptor = validatePartition(raw, `partitions.facts[${index}]`);
    if (!isRecord(raw)) throw new ArtifactError("malformed_artifact", "Invalid fact partition.");
    return {
      ...descriptor,
      page: requiredInteger(raw.page, `partitions.facts[${index}].page`, 1),
      count: requiredInteger(raw.count, `partitions.facts[${index}].count`),
    };
  });
  if (facts.length !== pageCount || facts.some((part, index) => part.page !== index + 1)) {
    throw new ArtifactError("partial_artifact", "Cross-dataset fact partition sequence is incomplete.");
  }
  if (facts.reduce((total, part) => total + part.count, 0) !== factCount) {
    throw new ArtifactError("partial_artifact", "Cross-dataset fact partition counts do not reconcile.");
  }
  if (!Array.isArray(value.source_ids) || value.source_ids.some((item) => typeof item !== "string")) {
    throw new ArtifactError("malformed_artifact", "Cross-dataset source_ids must be strings.");
  }
  return {
    schema_version: CROSS_DATASET_BUNDLE_SCHEMA,
    run_id: requiredString(value.run_id, "run_id"),
    snapshot_id: requiredString(value.snapshot_id, "snapshot_id"),
    fact_count: factCount,
    source_ids: value.source_ids as string[],
    page_size: pageSize,
    page_count: pageCount,
    partitions: {
      summary: validatePartition(value.partitions.summary, "partitions.summary"),
      groups: validatePartition(value.partitions.groups, "partitions.groups"),
      fact_index: validatePartition(value.partitions.fact_index, "partitions.fact_index"),
      facts,
    },
  };
}

function validateDocumentIdentity(
  value: unknown,
  manifest: CrossDatasetBundleManifest,
  path: string,
): asserts value is Record<string, unknown> {
  if (!isRecord(value) || value.schema_version !== CROSS_DATASET_BUNDLE_SCHEMA) {
    throw new ArtifactError("malformed_artifact", `Artifact partition ${path} has the wrong schema.`);
  }
  if (value.run_id !== manifest.run_id || value.snapshot_id !== manifest.snapshot_id) {
    throw new ArtifactError("stale_artifact", `Artifact partition ${path} belongs to another run or snapshot.`);
  }
}

export class CrossDatasetArtifactReader {
  private readonly readText: ReaderOptions["readText"];
  private readonly expectedRunId?: string;
  private readonly documentCache = new Map<string, Promise<unknown>>();
  private manifestPromise?: Promise<CrossDatasetBundleManifest>;

  constructor(options: ReaderOptions) {
    this.readText = options.readText;
    this.expectedRunId = options.expectedRunId;
  }

  async manifest(): Promise<CrossDatasetBundleManifest> {
    this.manifestPromise ??= (async () => {
      let text: string;
      try {
        text = await this.readText("manifest.json");
      } catch (error) {
        throw new ArtifactError("partial_artifact", "Cross-dataset manifest is unavailable.", {
          cause: error,
        });
      }
      const manifest = validateManifest(parseJson(text, "manifest.json"));
      if (this.expectedRunId && manifest.run_id !== this.expectedRunId) {
        throw new ArtifactError(
          "stale_artifact",
          `Expected Cross-dataset run ${this.expectedRunId}, found ${manifest.run_id}.`,
        );
      }
      return manifest;
    })();
    return this.manifestPromise;
  }

  private async partition(descriptor: PartitionDescriptor): Promise<unknown> {
    let pending = this.documentCache.get(descriptor.path);
    if (!pending) {
      pending = (async () => {
        let text: string;
        try {
          text = await this.readText(descriptor.path);
        } catch (error) {
          throw new ArtifactError(
            "partial_artifact",
            `Cross-dataset partition ${descriptor.path} is unavailable.`,
            { cause: error },
          );
        }
        const actual = createHash("sha256").update(text).digest("hex");
        if (actual !== descriptor.sha256) {
          throw new ArtifactError(
            "hash_mismatch",
            `Cross-dataset partition ${descriptor.path} failed its SHA-256 check.`,
          );
        }
        return parseJson(text, descriptor.path);
      })();
      this.documentCache.set(descriptor.path, pending);
    }
    return pending;
  }

  async summary(): Promise<CrossDatasetSummary> {
    const manifest = await this.manifest();
    const value = await this.partition(manifest.partitions.summary);
    validateDocumentIdentity(value, manifest, manifest.partitions.summary.path);
    if (
      value.fact_count !== manifest.fact_count ||
      value.matrix_complete !== true ||
      !Array.isArray(value.sources)
    ) {
      throw new ArtifactError("partial_artifact", "Cross-dataset summary is incomplete.");
    }
    const sourceIds = value.sources
      .map((source) => (isRecord(source) ? source.source_id : null))
      .filter((source): source is string => typeof source === "string");
    if (
      sourceIds.length !== manifest.source_ids.length ||
      manifest.source_ids.some((source) => !sourceIds.includes(source))
    ) {
      throw new ArtifactError("partial_artifact", "Cross-dataset summary source set is incomplete.");
    }
    return value as unknown as CrossDatasetSummary;
  }

  async groups(options: { dimension?: string; source?: string } = {}): Promise<CrossDatasetGroupsDocument> {
    const manifest = await this.manifest();
    if (options.source && !manifest.source_ids.includes(options.source)) {
      return { schema_version: CROSS_DATASET_BUNDLE_SCHEMA, run_id: manifest.run_id, snapshot_id: manifest.snapshot_id, groups: [] };
    }
    const value = await this.partition(manifest.partitions.groups);
    validateDocumentIdentity(value, manifest, manifest.partitions.groups.path);
    if (!Array.isArray(value.groups)) {
      throw new ArtifactError("partial_artifact", "Cross-dataset groups are incomplete.");
    }
    let groups = value.groups as CrossDatasetGroup[];
    if (options.dimension) groups = groups.filter((group) => group.dimension === options.dimension);
    if (options.source) {
      groups = groups.map((group) => ({
        ...group,
        sources: group.sources[options.source!]
          ? { [options.source!]: group.sources[options.source!] }
          : {},
      }));
    }
    return {
      schema_version: CROSS_DATASET_BUNDLE_SCHEMA,
      run_id: manifest.run_id,
      snapshot_id: manifest.snapshot_id,
      groups,
    };
  }

  async source(sourceId: string): Promise<{ source: SourceSummary; groups: CrossDatasetGroup[] } | null> {
    const summary = await this.summary();
    const source = summary.sources.find((item) => item.source_id === sourceId);
    if (!source) return null;
    const groups = await this.groups({ source: sourceId });
    return { source, groups: groups.groups };
  }

  private async factPage(page: number): Promise<FactPageDocument> {
    const manifest = await this.manifest();
    const descriptor = manifest.partitions.facts[page - 1];
    if (!descriptor) {
      return {
        schema_version: CROSS_DATASET_BUNDLE_SCHEMA,
        run_id: manifest.run_id,
        snapshot_id: manifest.snapshot_id,
        page,
        page_size: manifest.page_size,
        total: manifest.fact_count,
        rows: [],
      };
    }
    const value = await this.partition(descriptor);
    validateDocumentIdentity(value, manifest, descriptor.path);
    if (
      value.page !== page ||
      value.page_size !== manifest.page_size ||
      value.total !== manifest.fact_count ||
      !Array.isArray(value.rows) ||
      value.rows.length !== descriptor.count
    ) {
      throw new ArtifactError("partial_artifact", `Cross-dataset fact page ${page} is incomplete.`);
    }
    return value as unknown as FactPageDocument;
  }

  private async factIndex(): Promise<FactIndexDocument> {
    const manifest = await this.manifest();
    const value = await this.partition(manifest.partitions.fact_index);
    validateDocumentIdentity(value, manifest, manifest.partitions.fact_index.path);
    if (!isRecord(value.facts) || !isRecord(value.facets)) {
      throw new ArtifactError("partial_artifact", "Cross-dataset fact index is incomplete.");
    }
    for (const dimension of [
      "ledger_source",
      "measure",
      "period",
      "geography",
      "source_status",
      "source_period_treatment",
      "source_calibration_exposure",
    ]) {
      if (!isRecord(value.facets[dimension])) {
        throw new ArtifactError("partial_artifact", `Cross-dataset ${dimension} index is incomplete.`);
      }
    }
    return value as unknown as FactIndexDocument;
  }

  private async candidatePages(query: FactsQuery): Promise<number[]> {
    const manifest = await this.manifest();
    const index = await this.factIndex();
    const candidates: number[][] = [];
    const add = (values: number[] | undefined) => candidates.push(values ?? []);
    if (query.ledgerSource) add(index.facets.ledger_source[query.ledgerSource]);
    if (query.measure) add(index.facets.measure[query.measure]);
    if (query.period) add(index.facets.period[query.period]);
    if (query.geography) add(index.facets.geography[query.geography]);
    if (query.source && query.status) {
      add(index.facets.source_status[query.source]?.[query.status]);
    }
    if (query.source && query.periodTreatment) {
      add(index.facets.source_period_treatment[query.source]?.[query.periodTreatment]);
    }
    if (query.source && query.calibrationExposure) {
      add(index.facets.source_calibration_exposure[query.source]?.[query.calibrationExposure]);
    }
    if (!candidates.length) {
      return Array.from({ length: manifest.page_count }, (_, index) => index + 1);
    }
    return [...new Set(candidates[0])]
      .filter((page) => candidates.every((values) => values.includes(page)))
      .sort((left, right) => left - right);
  }

  async facts(query: FactsQuery = {}): Promise<FactsPage> {
    const manifest = await this.manifest();
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? manifest.page_size;
    if (!Number.isInteger(page) || page < 1) throw new RangeError("page must be a positive integer");
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 250) {
      throw new RangeError("page_size must be between 1 and 250");
    }
    const filtered = Boolean(
      query.status || query.ledgerSource || query.measure || query.period || query.geography || query.periodTreatment || query.calibrationExposure || query.search,
    );
    const sort = query.sort ?? "fact_key";
    if (!filtered && sort === "fact_key" && pageSize === manifest.page_size) {
      const direct = await this.factPage(page);
      return {
        ...direct,
        page_count: manifest.page_count,
      };
    }
    const candidatePages = await this.candidatePages(query);
    let rows = (
      await Promise.all(candidatePages.map((candidatePage) => this.factPage(candidatePage)))
    ).flatMap((document) => document.rows);
    const search = query.search?.trim().toLowerCase();
    rows = rows.filter((row) => {
      const cell = query.source ? row.sources[query.source] : undefined;
      return (
        (!query.source || cell != null) &&
        (!query.status || cell?.status === query.status) &&
        (!query.ledgerSource || row.ledger_source === query.ledgerSource) &&
        (!query.measure || row.measure === query.measure) &&
        (!query.period || row.observed_period === query.period) &&
        (!query.geography || row.geography_level === query.geography) &&
        (!query.periodTreatment || cell?.period_treatment === query.periodTreatment) &&
        (!query.calibrationExposure || cell?.calibration_exposure === query.calibrationExposure) &&
        (!search || `${row.fact_key} ${row.label} ${row.measure}`.toLowerCase().includes(search))
      );
    });
    if (sort === "label") {
      rows.sort(
        (left, right) =>
          left.label.localeCompare(right.label) || left.fact_key.localeCompare(right.fact_key),
      );
    } else if (sort === "error_desc") {
      if (!query.source) throw new RangeError("error_desc sorting requires a source");
      const source = query.source;
      rows.sort((left, right) => {
        const leftValue = Number(left.sources[source]?.absolute_relative_error);
        const rightValue = Number(right.sources[source]?.absolute_relative_error);
        const leftError = Number.isFinite(leftValue) ? leftValue : Number.NEGATIVE_INFINITY;
        const rightError = Number.isFinite(rightValue) ? rightValue : Number.NEGATIVE_INFINITY;
        return rightError - leftError || left.fact_key.localeCompare(right.fact_key);
      });
    }
    const total = rows.length;
    const start = (page - 1) * pageSize;
    return {
      schema_version: CROSS_DATASET_BUNDLE_SCHEMA,
      run_id: manifest.run_id,
      snapshot_id: manifest.snapshot_id,
      page,
      page_size: pageSize,
      page_count: Math.ceil(total / pageSize),
      total,
      rows: rows.slice(start, start + pageSize),
    };
  }

  async fact(factKey: string): Promise<CrossDatasetFact | null> {
    const manifest = await this.manifest();
    const index = await this.factIndex();
    const page = index.facts[factKey];
    if (page == null) return null;
    if (!Number.isInteger(page) || (page as number) < 1 || (page as number) > manifest.page_count) {
      throw new ArtifactError("partial_artifact", `Cross-dataset fact index is invalid for ${factKey}.`);
    }
    const document = await this.factPage(page as number);
    const fact = document.rows.find((row) => row.fact_key === factKey);
    if (!fact) {
      throw new ArtifactError("partial_artifact", `Cross-dataset fact ${factKey} is absent from its indexed page.`);
    }
    return fact;
  }
}
