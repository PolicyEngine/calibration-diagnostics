type JsonObject = Record<string, unknown>;

export interface HierarchyTargetDimension {
  key: string;
  label: string;
  value: string;
  value_id: string;
  source_key: string;
  raw_value: string;
  rank: number;
}

export interface HierarchyTargetIdentity {
  source: string;
  sourceLabel: string;
  variable: string;
  variableLabel: string;
  geography: string;
  geographyId: string;
  level: string;
  dimensions: HierarchyTargetDimension[];
  targetId: string;
  targetLabel: string;
  breakdown: string;
}

function isPlainObject(value: unknown): value is JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function requiredObject(value: unknown, path: string): JsonObject {
  if (!isPlainObject(value)) {
    throw new Error(`Schema 8 target ${path} must be an object.`);
  }
  return value;
}

function requiredString(value: unknown, path: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Schema 8 target ${path} must be a non-empty string.`);
  }
  return value.trim();
}

function node(value: unknown, path: string): { id: string; label: string } {
  const object = requiredObject(value, path);
  return {
    id: requiredString(object.id, `${path}.id`),
    label: requiredString(object.label, `${path}.label`),
  };
}

/** Read the complete, producer-authored hierarchy on one schema-8 row. */
export function readHierarchyTarget(row: JsonObject): HierarchyTargetIdentity {
  const hierarchy = requiredObject(row.hierarchy, "hierarchy");
  const provider = node(hierarchy.provider, "hierarchy.provider");
  const categoryObject = requiredObject(
    hierarchy.category,
    "hierarchy.category",
  );
  const category = node(categoryObject, "hierarchy.category");
  const categoryProviderId = requiredString(
    categoryObject.provider_id,
    "hierarchy.category.provider_id",
  );
  if (categoryProviderId !== provider.id) {
    throw new Error(
      `Schema 8 category ${category.id} references provider ` +
        `${categoryProviderId}, expected ${provider.id}.`,
    );
  }

  const geographyObject = requiredObject(
    hierarchy.geography,
    "hierarchy.geography",
  );
  const geography = node(geographyObject, "hierarchy.geography");
  const geographyLevel = requiredString(
    geographyObject.level,
    "hierarchy.geography.level",
  );

  if (!Array.isArray(hierarchy.dimensions)) {
    throw new Error("Schema 8 target hierarchy.dimensions must be an array.");
  }
  const dimensionIds = new Set<string>();
  const dimensions = hierarchy.dimensions.map((value, rank) => {
    const object = requiredObject(value, `hierarchy.dimensions[${rank}]`);
    const id = requiredString(object.id, `hierarchy.dimensions[${rank}].id`);
    if (dimensionIds.has(id)) {
      throw new Error(`Schema 8 target contains duplicate dimension id ${id}.`);
    }
    dimensionIds.add(id);
    const valueId = requiredString(
      object.value_id,
      `hierarchy.dimensions[${rank}].value_id`,
    );
    return {
      key: id,
      label: requiredString(
        object.label,
        `hierarchy.dimensions[${rank}].label`,
      ),
      value: requiredString(
        object.value_label,
        `hierarchy.dimensions[${rank}].value_label`,
      ),
      value_id: valueId,
      source_key: id,
      raw_value: valueId,
      rank,
    };
  });

  const target = node(hierarchy.target, "hierarchy.target");
  const rowTargetId =
    typeof row.target_name === "string" && row.target_name.trim()
      ? row.target_name.trim()
      : typeof row.name === "string"
        ? row.name.replace(/@[^@]+$/, "").trim()
        : "";
  if (rowTargetId && rowTargetId !== target.id) {
    throw new Error(
      `Schema 8 hierarchy target id ${target.id} does not match row target ` +
        `${rowTargetId}.`,
    );
  }

  return {
    source: provider.id,
    sourceLabel: provider.label,
    variable: category.id,
    variableLabel: category.label,
    geography: geography.label,
    geographyId: geography.id,
    level: geographyLevel,
    dimensions,
    targetId: target.id,
    targetLabel: target.label,
    breakdown: dimensions.map((dimension) => dimension.value).join(" · "),
  };
}

function requireConsistentLabel(
  labels: Map<string, string>,
  id: string,
  label: string,
  kind: string,
): void {
  const existing = labels.get(id);
  if (existing != null && existing !== label) {
    throw new Error(
      `Schema 8 ${kind} ${id} has inconsistent labels: ` +
        `${existing} and ${label}.`,
    );
  }
  labels.set(id, label);
}

/** Require stable labels for every repeated hierarchy identifier in a file. */
export function validateHierarchyTargets(rows: JsonObject[]): void {
  const providers = new Map<string, string>();
  const categories = new Map<string, string>();
  const categoryProviders = new Map<string, string>();
  const geographies = new Map<string, string>();
  const dimensions = new Map<string, string>();
  const dimensionValues = new Map<string, string>();
  const targets = new Map<string, string>();
  for (const row of rows) {
    const identity = readHierarchyTarget(row);
    requireConsistentLabel(
      providers,
      identity.source,
      identity.sourceLabel,
      "provider",
    );
    requireConsistentLabel(
      categories,
      identity.variable,
      identity.variableLabel,
      "category",
    );
    const categoryProvider = categoryProviders.get(identity.variable);
    if (categoryProvider != null && categoryProvider !== identity.source) {
      throw new Error(
        `Schema 8 category ${identity.variable} references inconsistent ` +
          `providers: ${categoryProvider} and ${identity.source}.`,
      );
    }
    categoryProviders.set(identity.variable, identity.source);
    requireConsistentLabel(
      geographies,
      `${identity.level}\0${identity.geographyId}`,
      identity.geography,
      "geography",
    );
    for (const dimension of identity.dimensions) {
      requireConsistentLabel(
        dimensions,
        dimension.key,
        dimension.label,
        "dimension",
      );
      requireConsistentLabel(
        dimensionValues,
        `${dimension.key}\0${dimension.value_id}`,
        dimension.value,
        "dimension value",
      );
    }
    requireConsistentLabel(
      targets,
      identity.targetId,
      identity.targetLabel,
      "target",
    );
  }
}
