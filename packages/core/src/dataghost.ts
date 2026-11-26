import { GENERATOR_VERSION, GeneratorRegistry, randomSeed, type GeneratorDefinition, type GeneratorFn, type Seed } from "@workfonic/dataghost-generators";
import type { Transformation } from "@workfonic/dataghost-privacy";
import { normalizeRelationships, type RelationshipConfig } from "@workfonic/dataghost-relationships";
import { CollectionGenerator, DEFAULT_REFERENCE_DATE, generateDatasetSync, prepareDataset, type DataRecord, type Dataset, type DatasetConfig, type DatasetReport } from "./engine.js";
import { ConfigError } from "./errors.js";
import { detectFormat, parseText, serialize, toDataset, type DataFormat } from "./formats/index.js";
import type { CsvWriteOptions } from "./formats/csv.js";
import { inspectDataset, toRelationshipConfigs, type InspectionReport, type InspectOptions, type OverrideMap } from "./inspect.js";
import { transformDataset, type TransformReport } from "./modes.js";
import { normalizeSchema, type SchemaInput } from "./schema.js";
import { validateDatasetFull, validateRecords, type DatasetValidation, type ValidationResult } from "./validate.js";

export interface DataGhostOptions {
  /** Seed for deterministic output. A random seed is chosen (and reported) when omitted. */
  seed?: Seed;
  /** "Now" for relative dates (default 2026-01-01T00:00:00Z) so output stays reproducible. */
  referenceDate?: string | Date;
  /** Custom generator functions, usable by name in schemas. SDK only. */
  generators?: Record<string, GeneratorFn<any>>;
}

export interface GenerateOptions {
  schema: SchemaInput;
  count: number;
  /** Override the instance seed for this call. */
  seed?: Seed;
  /** Collection name; part of the seed derivation (default "records"). */
  name?: string;
}

export interface SynthesizeOptions extends InspectOptions {
  /** Target size: a number scales collections proportionally so the largest has this many records; or counts per collection. */
  count?: number | Record<string, number>;
  /** Relationships to keep; merged with detected ones (configured entries win for the same field). */
  relationships?: RelationshipConfig[];
  /** Use relationships detected in the source (default true). */
  useDetectedRelationships?: boolean;
  seed?: Seed;
}

export interface TransformCallOptions extends InspectOptions {
  transformations?: Record<string, Transformation>;
  relationships?: RelationshipConfig[];
  keep?: string[];
  seed?: Seed;
}

export type DataInput = unknown;

/** Scale source counts so that the largest collection has `target` records. */
export function scaleCounts(source: Record<string, number>, target: number | Record<string, number> | undefined): Record<string, number> {
  if (target === undefined) return { ...source };
  if (typeof target === "object") {
    for (const k of Object.keys(target)) if (!(k in source)) throw new ConfigError(`Count given for unknown collection "${k}"`);
    return Object.fromEntries(Object.entries(source).map(([k, n]) => [k, target[k] ?? n]));
  }
  if (!Number.isInteger(target) || target < 0) throw new ConfigError(`Count must be a non-negative integer (got ${target})`);
  const max = Math.max(1, ...Object.values(source));
  return Object.fromEntries(Object.entries(source).map(([k, n]) => [k, n === max ? target : Math.max(target > 0 ? 1 : 0, Math.round((n / max) * target))]));
}

/**
 * The DataGhost SDK. All processing is local and in memory; nothing is
 * uploaded or logged.
 *
 * @example
 * const ghost = new DataGhost({ seed: 12345 });
 * const people = await ghost.generate({ schema: { name: "fullName", email: "email" }, count: 10 });
 */
export class DataGhost {
  readonly seed: Seed;
  readonly referenceDate: Date;
  readonly registry: GeneratorRegistry;
  readonly generatorVersion = GENERATOR_VERSION;

  constructor(options: DataGhostOptions = {}) {
    if (options.seed !== undefined && !(typeof options.seed === "string" || Number.isSafeInteger(options.seed))) {
      throw new ConfigError("seed must be an integer or a string");
    }
    this.seed = options.seed ?? randomSeed();
    const ref = options.referenceDate ?? DEFAULT_REFERENCE_DATE;
    this.referenceDate = ref instanceof Date ? ref : new Date(ref);
    if (Number.isNaN(this.referenceDate.getTime())) throw new ConfigError(`Invalid referenceDate "${String(options.referenceDate)}"`);
    this.registry = new GeneratorRegistry();
    for (const [name, fn] of Object.entries(options.generators ?? {})) this.registry.register(name, fn);
  }

  /** Register a custom generator function (SDK only; never available to the playground). */
  registerGenerator(name: string, fn: GeneratorFn<any>, meta?: { description?: string; output?: GeneratorDefinition["output"] }): this {
    this.registry.register(name, fn, meta);
    return this;
  }

  /** List available generators. */
  generators(): { name: string; category: string; description: string }[] {
    return this.registry.list().map((g) => ({ name: g.name, category: g.category, description: g.description }));
  }

  private engine(seed?: Seed) {
    return { seed: seed ?? this.seed, registry: this.registry, referenceDate: this.referenceDate };
  }

  /** Generate `count` records from a schema. */
  async generate(options: GenerateOptions): Promise<DataRecord[]> {
    return this.generateSync(options);
  }

  generateSync(options: GenerateOptions): DataRecord[] {
    const prepared = prepareDataset({ collections: { [options.name ?? "records"]: { schema: options.schema, count: options.count } } }, this.registry, true);
    const name = options.name ?? "records";
    const gen = new CollectionGenerator(name, prepared.schemas[name]!, this.engine(options.seed));
    return Array.from(gen.take(prepared.counts[name]!));
  }

  /**
   * Stream records one at a time without holding them in memory. Produces
   * exactly the same records as generate() for the same seed and schema.
   */
  async *stream(options: GenerateOptions): AsyncGenerator<DataRecord> {
    const name = options.name ?? "records";
    const schema = normalizeSchema(options.schema, { registry: this.registry, allowFunctions: true });
    if (!Number.isInteger(options.count) || options.count < 0) throw new ConfigError("count must be a non-negative integer");
    const gen = new CollectionGenerator(name, schema, this.engine(options.seed));
    for (let i = 0; i < options.count; i++) {
      yield gen.next();
    }
  }

  /** Generate several related collections with referential integrity. */
  async generateDataset(config: DatasetConfig & { seed?: Seed }): Promise<{ data: Dataset; report: DatasetReport }> {
    const prepared = prepareDataset(config, this.registry, true);
    return generateDatasetSync(prepared, this.engine(config.seed), GENERATOR_VERSION);
  }

  /** Parse text (JSON, JSONL or CSV) into a dataset. */
  parse(text: string, formatOrFileName?: DataFormat | string, options: { name?: string; maxBytes?: number } = {}): Dataset {
    const format = formatOrFileName === "json" || formatOrFileName === "jsonl" || formatOrFileName === "csv" ? formatOrFileName : detectFormat(formatOrFileName, text);
    return toDataset(parseText(text, format, options.maxBytes), options.name);
  }

  private dataset(input: DataInput): Dataset {
    return toDataset(input);
  }

  /** Infer schemas, detect relationships and flag potentially sensitive fields. */
  inspect(input: DataInput, options: InspectOptions = {}): InspectionReport {
    return inspectDataset(this.dataset(input), options);
  }

  /** Mode A: generate new synthetic data shaped like the source. */
  async synthesize(input: DataInput, options: SynthesizeOptions = {}): Promise<{ data: Dataset; report: DatasetReport; inspection: InspectionReport }> {
    const dataset = this.dataset(input);
    const inspection = inspectDataset(dataset, options);
    const config = this.configFromInspection(inspection, options);
    const out = await this.generateDataset({ ...config, seed: options.seed });
    return { ...out, inspection };
  }

  /** Build a dataset generation config from an inspection report. */
  configFromInspection(inspection: InspectionReport, options: Pick<SynthesizeOptions, "count" | "relationships" | "useDetectedRelationships"> = {}): DatasetConfig {
    const source = Object.fromEntries(inspection.collections.map((c) => [c.name, c.recordCount]));
    const counts = scaleCounts(source, options.count);
    const detected = options.useDetectedRelationships === false ? [] : toRelationshipConfigs(inspection.relationships).map(({ nullable: _n, ...r }) => r);
    const configured = options.relationships ?? [];
    const fromKey = (r: RelationshipConfig) => {
      const n = normalizeRelationships([r])[0]!;
      return `${n.from.collection}.${n.from.path}`;
    };
    const configuredFrom = new Set(configured.map(fromKey));
    const relationships = [...configured, ...detected.filter((r) => !configuredFrom.has(fromKey(r)))];
    return {
      collections: Object.fromEntries(inspection.collections.map((c) => [c.name, { schema: c.schema, count: counts[c.name]! }])),
      relationships,
    };
  }

  /** Mode B: mask sensitive fields, keep everything else. */
  async mask(input: DataInput, options: TransformCallOptions = {}): Promise<{ data: Dataset; report: TransformReport; inspection: InspectionReport }> {
    return this.transform(input, "mask", options);
  }

  /** Mode C: keep structure (keys, nesting, nulls, array lengths, formats, relationships) and replace values. */
  async preserve(input: DataInput, options: TransformCallOptions = {}): Promise<{ data: Dataset; report: TransformReport; inspection: InspectionReport }> {
    return this.transform(input, "preserve", options);
  }

  async transform(input: DataInput, mode: "mask" | "preserve", options: TransformCallOptions = {}): Promise<{ data: Dataset; report: TransformReport; inspection: InspectionReport }> {
    const dataset = this.dataset(input);
    const inspection = inspectDataset(dataset, options);
    const relationships = options.relationships ?? toRelationshipConfigs(inspection.relationships);
    const out = transformDataset(dataset, inspection, this.registry, {
      mode,
      seed: options.seed ?? this.seed,
      transformations: options.transformations,
      relationships,
      keep: options.keep,
      referenceDate: this.referenceDate,
    });
    return { ...out, inspection };
  }

  /** Validate records against a schema. */
  validate(records: DataRecord[], schema: SchemaInput): ValidationResult {
    return validateRecords(records, normalizeSchema(schema, { registry: this.registry, allowFunctions: true }));
  }

  /** Validate a dataset: optional schemas, relationships, and a scan for real-looking values. */
  validateDataset(dataset: Dataset, options: { schemas?: Record<string, SchemaInput>; relationships?: RelationshipConfig[]; safetyScan?: boolean } = {}): DatasetValidation {
    const schemas = options.schemas ? Object.fromEntries(Object.entries(options.schemas).map(([k, s]) => [k, normalizeSchema(s, { registry: this.registry, allowFunctions: true })])) : undefined;
    return validateDatasetFull(dataset, { schemas, relationships: options.relationships, safetyScan: options.safetyScan });
  }

  /** Serialise records or a dataset as JSON, JSONL or CSV. */
  export(data: DataRecord[] | Dataset, format: DataFormat, options: { pretty?: boolean; csv?: CsvWriteOptions } = {}): string {
    return serialize(data, format, options);
  }
}

export type { OverrideMap };
