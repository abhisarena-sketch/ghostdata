import { createRng, type GeneratorContext, type GeneratorRegistry, type Rng, type Seed } from "@workfonic/dataghost-generators";
import {
  assertIntegrity,
  assignForeignKeys,
  dependencyOrder,
  normalizeRelationships,
  RelationshipConfigError,
  type IntegrityReport,
  type NormalizedRelationship,
  type RelationshipConfig,
} from "@workfonic/dataghost-relationships";
import { ConfigError, GenerationError, InvalidSchemaError, LimitError } from "./errors.js";
import { fieldAtPath, INDEX_UNIQUE_GENERATORS, normalizeSchema, type NormalizedField, type NormalizedLeaf, type NormalizedObject, type SchemaInput } from "./schema.js";

export type DataRecord = Record<string, unknown>;
export type Dataset = Record<string, DataRecord[]>;

/** Fixed default reference date so that relative dates are reproducible. */
export const DEFAULT_REFERENCE_DATE = "2026-01-01T00:00:00.000Z";
export const MAX_RECORDS_PER_COLLECTION = 10_000_000;
const UNIQUE_ATTEMPTS = 50;

export interface EngineOptions {
  seed: Seed;
  registry: GeneratorRegistry;
  referenceDate?: Date;
}

interface FieldState {
  rng: Rng;
  meta: Rng;
  seen?: Set<string>;
}

/**
 * Generates records for one collection. Each field path has its own RNG
 * stream, so adding or removing a field does not change the values of the
 * other fields for the same seed.
 */
export class CollectionGenerator {
  private readonly states = new Map<string, FieldState>();
  private readonly root: Rng;
  private readonly referenceDate: Date;
  private index = 0;

  constructor(
    readonly name: string,
    readonly schema: NormalizedObject,
    private readonly options: EngineOptions,
  ) {
    this.root = createRng(options.seed).fork(`collection:${name}`);
    this.referenceDate = options.referenceDate ?? new Date(DEFAULT_REFERENCE_DATE);
  }

  private state(path: string, unique: boolean): FieldState {
    let s = this.states.get(path);
    if (!s) {
      s = { rng: this.root.fork(`field:${path}`), meta: this.root.fork(`meta:${path}`) };
      this.states.set(path, s);
    }
    if (unique && !s.seen) s.seen = new Set();
    return s;
  }

  next(): DataRecord {
    const record = this.object(this.schema, "", this.index, true) as DataRecord;
    this.index++;
    return record;
  }

  *take(count: number): Generator<DataRecord> {
    for (let i = 0; i < count; i++) yield this.next();
  }

  private object(node: NormalizedObject, path: string, index: number, root = false): DataRecord | null {
    const out: DataRecord = {};
    for (const [key, field] of node.fields) {
      const p = path ? `${path}.${key}` : key;
      const meta = this.state(p, false).meta;
      if (field.missingRate > 0 && meta.bool(field.missingRate)) continue;
      if (field.nullRate > 0 && meta.bool(field.nullRate)) {
        out[key] = null;
        continue;
      }
      out[key] = this.value(field, p, index, out);
    }
    void root;
    return out;
  }

  private value(field: NormalizedField, path: string, index: number, siblings: DataRecord): unknown {
    let v: unknown;
    if (field.kind === "object") v = this.object(field, path, index);
    else if (field.kind === "array") {
      const st = this.state(path, false);
      const len = st.meta.int(field.minItems, field.maxItems);
      const items: unknown[] = [];
      const ip = `${path}[]`;
      for (let i = 0; i < len; i++) {
        const meta = this.state(ip, false).meta;
        if (field.items.nullRate > 0 && meta.bool(field.items.nullRate)) items.push(null);
        else items.push(this.value(field.items, ip, index, {}));
      }
      v = items;
    } else v = this.leaf(field, path, index, siblings);
    return field.wrap ? { [field.wrap]: v } : v;
  }

  private leaf(field: NormalizedLeaf, path: string, index: number, siblings: DataRecord): unknown {
    const enforceUnique = field.unique && !INDEX_UNIQUE_GENERATORS.has(field.generator);
    const st = this.state(path, enforceUnique);
    const ctx: GeneratorContext = { rng: st.rng, index, siblings, referenceDate: this.referenceDate, path };
    const gen = field.fn ?? this.options.registry.get(field.generator)?.generate;
    if (!gen) throw new GenerationError(`Unknown generator "${field.generator}" at "${path}"`, path);
    const run = () => {
      try {
        return gen(ctx, field.options);
      } catch (e) {
        throw new GenerationError(`Generator "${field.generator}" failed at "${path}" (record ${index}): ${(e as Error).message}`, path);
      }
    };
    if (!st.seen) return run();
    for (let attempt = 0; attempt < UNIQUE_ATTEMPTS; attempt++) {
      const v = run();
      const key = typeof v === "string" ? v : JSON.stringify(v);
      if (!st.seen.has(key)) {
        st.seen.add(key);
        return v;
      }
    }
    throw new GenerationError(
      `Could not generate a unique value for "${path}" after ${UNIQUE_ATTEMPTS} attempts (record ${index}). ` +
        `The generator "${field.generator}" has too few possible values for ${index + 1} records; widen its range or use "sequence"/"uuid".`,
      path,
    );
  }
}

export interface CollectionConfig {
  schema: SchemaInput;
  count: number;
}

export interface DatasetConfig {
  collections: Record<string, CollectionConfig>;
  relationships?: RelationshipConfig[];
}

export interface DatasetReport {
  seed: Seed;
  generatorVersion: string;
  order: string[];
  counts: Record<string, number>;
  integrity: IntegrityReport;
  durationMs: number;
}

function checkCount(count: unknown, name: string): number {
  if (typeof count !== "number" || !Number.isInteger(count) || count < 0) throw new ConfigError(`Count for "${name}" must be a non-negative integer (got ${String(count)})`);
  if (count > MAX_RECORDS_PER_COLLECTION) throw new LimitError(`Count for "${name}" exceeds the limit of ${MAX_RECORDS_PER_COLLECTION.toLocaleString("en-US")} records. Use streaming generation for larger outputs.`);
  return count;
}

export interface PreparedDataset {
  schemas: Record<string, NormalizedObject>;
  counts: Record<string, number>;
  relationships: NormalizedRelationship[];
  order: string[];
}

/** Validate and normalise a dataset config: schemas, relationship endpoints, key uniqueness and ordering. */
export function prepareDataset(config: DatasetConfig, registry: GeneratorRegistry, allowFunctions: boolean): PreparedDataset {
  if (!config || typeof config !== "object" || !config.collections || typeof config.collections !== "object") {
    throw new ConfigError('Dataset config needs a "collections" object');
  }
  const names = Object.keys(config.collections);
  if (!names.length) throw new ConfigError("Dataset config has no collections");
  const schemas: Record<string, NormalizedObject> = {};
  const counts: Record<string, number> = {};
  for (const name of names) {
    if (!/^[A-Za-z0-9_][A-Za-z0-9_-]{0,63}$/.test(name)) throw new ConfigError(`Collection name "${name}" must be 1-64 letters, digits, "_" or "-"`);
    const c = config.collections[name]!;
    try {
      schemas[name] = normalizeSchema(c.schema, { registry, allowFunctions });
    } catch (e) {
      if (e instanceof InvalidSchemaError) throw new InvalidSchemaError(`Collection "${name}": ${e.message}`, `${name}.${e.path}`, e.details);
      throw e;
    }
    counts[name] = checkCount(c.count, name);
  }

  let relationships: NormalizedRelationship[];
  try {
    relationships = normalizeRelationships(config.relationships ?? []);
  } catch (e) {
    if (e instanceof RelationshipConfigError) throw new ConfigError(e.message);
    throw e;
  }
  for (const rel of relationships) {
    for (const end of [rel.from, rel.to]) {
      if (!schemas[end.collection]) throw new ConfigError(`Relationship "${rel.id}" refers to unknown collection "${end.collection}"`);
    }
    const target = fieldAtPath(schemas[rel.to.collection]!, rel.to.segments);
    if (!target || target.kind !== "leaf") {
      throw new ConfigError(`Relationship "${rel.id}": key "${rel.to.collection}.${rel.to.path}" is not a field of the "${rel.to.collection}" schema`);
    }
    if (target.nullRate > 0 || target.missingRate > 0) {
      throw new ConfigError(`Relationship "${rel.id}": key "${rel.to.collection}.${rel.to.path}" must not be nullable or optional`);
    }
    target.unique = true;
    const source = fieldAtPath(schemas[rel.from.collection]!, rel.from.segments);
    if (!source) {
      if (rel.from.segments.length === 1) {
        // Add the foreign key field; its value is assigned by the relationship engine.
        schemas[rel.from.collection]!.fields.push([rel.from.path, { kind: "leaf", generator: "constant", options: { value: 0 }, unique: false, output: "any", nullRate: 0, missingRate: 0 }]);
      } else {
        throw new ConfigError(`Relationship "${rel.id}": field "${rel.from.collection}.${rel.from.path}" is not in the "${rel.from.collection}" schema`);
      }
    } else if (source.kind !== "leaf") {
      throw new ConfigError(`Relationship "${rel.id}": "${rel.from.collection}.${rel.from.path}" must be a value field, not an ${source.kind}`);
    }
  }
  let order: string[];
  try {
    order = dependencyOrder(names, relationships);
  } catch (e) {
    if (e instanceof RelationshipConfigError) throw new ConfigError(e.message);
    throw e;
  }
  return { schemas, counts, relationships, order };
}

/** Generate a whole dataset in dependency order and verify referential integrity. */
export function generateDatasetSync(prepared: PreparedDataset, options: EngineOptions, generatorVersion: string): { data: Dataset; report: DatasetReport } {
  const started = Date.now();
  const data: Dataset = {};
  const root = createRng(options.seed);
  const applied = new Set<string>();
  const apply = (rel: NormalizedRelationship) => {
    try {
      assignForeignKeys(data[rel.from.collection]!, data[rel.to.collection]!, rel, root.fork(`relationship:${rel.id}`));
    } catch (e) {
      if (e instanceof RelationshipConfigError) throw new GenerationError(e.message);
      throw e;
    }
    applied.add(rel.id);
  };
  for (const name of prepared.order) {
    const gen = new CollectionGenerator(name, prepared.schemas[name]!, options);
    data[name] = Array.from(gen.take(prepared.counts[name]!));
    for (const rel of prepared.relationships) {
      if (rel.from.collection !== name || rel.deferred) continue;
      apply(rel);
    }
  }
  for (const rel of prepared.relationships) if (!applied.has(rel.id)) apply(rel);
  // Never return silently broken foreign keys.
  const integrity = assertIntegrity(data, prepared.relationships);
  // Re-order output to match the config's collection order.
  const ordered: Dataset = {};
  for (const name of Object.keys(prepared.schemas)) ordered[name] = data[name]!;
  return {
    data: ordered,
    report: { seed: options.seed, generatorVersion, order: prepared.order, counts: prepared.counts, integrity, durationMs: Date.now() - started },
  };
}
