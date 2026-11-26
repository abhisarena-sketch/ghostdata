import { createRng, type GeneratorRegistry, type Rng, type Seed } from "@workfonic/dataghost-generators";
import {
  NEVER_KEEP,
  PRIVACY_LIMITATIONS,
  Pseudonymizer,
  TRANSFORMATIONS,
  defaultTransformation,
  transformValue,
  type SensitiveCategory,
  type Transformation,
} from "@workfonic/dataghost-privacy";
import { normalizeRelationships, validateIntegrity, type IntegrityReport, type RelationshipConfig } from "@workfonic/dataghost-relationships";
import { ConfigError } from "./errors.js";
import type { DataRecord, Dataset } from "./engine.js";
import type { CollectionInference, InferredField } from "./inference/infer.js";
import type { InspectionReport } from "./inspect.js";

export type PrivacyMode = "synthetic" | "mask" | "preserve";
export const PRIVACY_MODES: readonly PrivacyMode[] = ["synthetic", "mask", "preserve"];

export interface FieldPlan {
  path: string;
  category?: SensitiveCategory;
  transformation: Transformation | "regenerate";
  confidence: number;
  uncertain: boolean;
  reason: string;
}

export interface CollectionPlan {
  name: string;
  fields: Map<string, FieldPlan>;
  inference: CollectionInference;
}

export interface TransformOptions {
  mode: "mask" | "preserve";
  seed?: Seed;
  /** Per-field transformations, keyed "collection.path" (or bare "path" for single-collection data). */
  transformations?: Record<string, Transformation>;
  /** Relationships whose keys must stay consistent; detected ones are used when omitted. */
  relationships?: RelationshipConfig[];
  /** preserve mode: field paths whose values are kept as-is (non-sensitive fields only). */
  keep?: string[];
  referenceDate?: Date;
}

export interface TransformReport {
  mode: "mask" | "preserve";
  seeded: boolean;
  collections: { name: string; records: number; fields: FieldPlan[] }[];
  integrity?: IntegrityReport;
  warnings: string[];
  limitations: readonly string[];
}

function lookup(map: Record<string, Transformation> | undefined, collection: string, path: string, single: boolean): Transformation | undefined {
  if (!map) return undefined;
  const t = map[`${collection}.${path}`] ?? (single ? map[path] : undefined);
  if (t !== undefined && !TRANSFORMATIONS.includes(t)) {
    throw new ConfigError(`Unknown transformation "${t}" for "${collection}.${path}". Use one of: ${TRANSFORMATIONS.join(", ")}`);
  }
  return t;
}

/** Decide how each field is transformed, based on privacy classification, relationships and user overrides. */
export function planTransformations(report: InspectionReport, options: TransformOptions): CollectionPlan[] {
  const single = report.collections.length === 1;
  const rels = normalizeRelationships(options.relationships ?? report.relationships);
  const keyPaths = new Set<string>();
  for (const r of rels) {
    keyPaths.add(`${r.from.collection}.${r.from.path}`);
    keyPaths.add(`${r.to.collection}.${r.to.path}`);
  }
  const keep = new Set(options.keep ?? []);
  const plans: CollectionPlan[] = [];
  for (const c of report.collections) {
    const fields = new Map<string, FieldPlan>();
    for (const f of c.fields) {
      if (f.type === "object" || f.type === "array") continue;
      const user = lookup(options.transformations, c.name, f.path, single);
      const category = keyPaths.has(`${c.name}.${f.path}`) ? "identifier" : f.privacy?.category;
      const level = f.privacy?.level;
      let transformation: FieldPlan["transformation"];
      let reason: string;
      if (user) {
        transformation = user;
        reason = "configured";
        if (category && NEVER_KEEP.has(category) && (user === "keep" || user === "generalize")) {
          transformation = "redact";
          reason = "credentials are always redacted";
        }
      } else if (keyPaths.has(`${c.name}.${f.path}`)) {
        transformation = "pseudonymize";
        reason = "relationship key: consistent pseudonym keeps references valid";
      } else if (category && level && level !== "none") {
        transformation = defaultTransformation(category);
        reason = `detected ${category}`;
        if (options.mode === "preserve" && transformation === "keep") transformation = "regenerate";
      } else {
        transformation = options.mode === "preserve" && !keep.has(f.path) && !keep.has(`${c.name}.${f.path}`) ? "regenerate" : "keep";
        reason = transformation === "keep" ? (options.mode === "mask" ? "not detected as sensitive" : "kept by configuration") : "replaced with a synthetic value of the same type and distribution";
      }
      fields.set(f.path, {
        path: f.path,
        category,
        transformation,
        confidence: f.privacy?.confidence ?? 0,
        uncertain: f.privacy?.uncertain ?? false,
        reason,
      });
    }
    plans.push({ name: c.name, fields, inference: c });
  }
  return plans;
}

function isExtended(v: Record<string, unknown>): string | undefined {
  const keys = Object.keys(v);
  return keys.length === 1 && keys[0]!.startsWith("$") ? keys[0] : undefined;
}

interface Regenerator {
  (siblings: DataRecord, index: number, rng?: Rng): unknown;
}

/** Generators that carry semantic meaning and can stand in for a masked value. */
const NON_SEMANTIC = new Set(["enum", "string", "sentence", "pattern", "sequence", "constant", "null", "integer", "decimal", "number", "boolean", "custom"]);

/**
 * Applies a collection plan to records one at a time (suitable for streaming).
 * The same instance must be used for all collections of a dataset so that
 * identifiers map consistently across collections.
 */
export class RecordTransformer {
  readonly pseudonymizer: Pseudonymizer;
  private readonly rng: Rng;
  private readonly regenerators = new Map<string, Regenerator>();
  private readonly referenceDate: Date;
  private index = 0;

  constructor(
    private readonly registry: GeneratorRegistry,
    private readonly options: TransformOptions,
  ) {
    this.pseudonymizer = new Pseudonymizer(options.seed !== undefined ? `seed:${String(options.seed)}` : undefined);
    this.rng = createRng(options.seed ?? `unseeded:${Math.random()}`).fork(`transform:${options.mode}`);
    this.referenceDate = options.referenceDate ?? new Date("2026-01-01T00:00:00.000Z");
  }

  private regenerator(collection: string, field: InferredField): Regenerator {
    const key = `${collection}|${field.path}`;
    let r = this.regenerators.get(key);
    if (r) return r;
    const s = field.suggestedGenerator ?? { type: "string", options: {} };
    const def = this.registry.get(s.type) ?? this.registry.get("string")!;
    let opts: Record<string, unknown>;
    try {
      opts = this.registry.parseOptions(def.name, s.options, field.path);
    } catch {
      opts = this.registry.parseOptions("string", {}, field.path);
    }
    const rng = this.rng.fork(`field:${key}`);
    const referenceDate = this.referenceDate;
    r = (siblings, index, override) => def.generate({ rng: override ?? rng, index, siblings, referenceDate, path: field.path }, opts);
    this.regenerators.set(key, r);
    return r;
  }

  transform(record: DataRecord, plan: CollectionPlan): DataRecord {
    const index = this.index++;
    const fieldsByPath = new Map(plan.inference.fields.map((f) => [f.path, f]));
    const leaf = (value: unknown, path: string, siblings: DataRecord): unknown => {
      const p = plan.fields.get(path);
      if (value === null || value === undefined) return value;
      if (!p) return this.options.mode === "preserve" ? null : value;
      if (p.transformation === "regenerate") {
        const f = fieldsByPath.get(path);
        return f ? this.regenerator(plan.name, f)(siblings, index) : value;
      }
      const f = fieldsByPath.get(path);
      const semantic = f?.suggestedGenerator && !NON_SEMANTIC.has(f.suggestedGenerator.type) && p.category !== "identifier" ? this.regenerator(plan.name, f) : undefined;
      return transformValue(value, p.transformation, {
        pseudonymizer: this.pseudonymizer,
        rng: this.rng,
        referenceDate: this.referenceDate,
        category: p.category,
        synthesize: semantic ? (rng) => semantic({}, index, rng) : undefined,
      });
    };
    const walk = (node: unknown, path: string, siblings: DataRecord): unknown => {
      if (Array.isArray(node)) return node.map((el) => walk(el, `${path}[]`, {}));
      if (node !== null && typeof node === "object") {
        const obj = node as Record<string, unknown>;
        const ext = isExtended(obj);
        if (ext) {
          const inner = leaf(obj[ext], path, siblings);
          return inner === null || inner === undefined ? inner : { [ext]: inner };
        }
        const out: DataRecord = {};
        for (const [k, v] of Object.entries(obj)) {
          if (k === "__proto__") continue;
          out[k] = walk(v, path ? `${path}.${k}` : k, out);
        }
        return out;
      }
      return leaf(node, path, siblings);
    };
    return walk(record, "", {}) as DataRecord;
  }
}

/** Mask or structure-preserve a whole in-memory dataset. */
export function transformDataset(
  dataset: Dataset,
  report: InspectionReport,
  registry: GeneratorRegistry,
  options: TransformOptions,
): { data: Dataset; report: TransformReport } {
  const plans = planTransformations(report, options);
  const transformer = new RecordTransformer(registry, options);
  const data: Dataset = {};
  for (const plan of plans) data[plan.name] = (dataset[plan.name] ?? []).map((r) => transformer.transform(r, plan));
  const rels = options.relationships ?? report.relationships;
  const integrity = rels.length ? validateIntegrity(data, rels) : undefined;
  return { data, report: buildTransformReport(plans, options, dataset, integrity) };
}

export function buildTransformReport(plans: CollectionPlan[], options: TransformOptions, dataset: Dataset | Record<string, { length: number }>, integrity?: IntegrityReport): TransformReport {
  const warnings: string[] = [];
  for (const plan of plans) {
    for (const f of plan.fields.values()) {
      const where = `${plan.name}.${f.path}`;
      if (f.uncertain) warnings.push(`${where}: classification uncertain (${f.category}, confidence ${f.confidence.toFixed(2)}); transformation "${f.transformation}" applied.`);
      if (f.transformation === "keep" && f.category && f.category !== "quasiIdentifier") warnings.push(`${where}: detected as ${f.category} but kept unchanged by configuration.`);
      if (f.transformation === "keep" && f.category === "quasiIdentifier") warnings.push(`${where}: quasi-identifier kept unchanged; consider "generalize".`);
    }
  }
  if (options.mode === "mask") {
    warnings.push("Mask mode keeps every field that was not detected as sensitive. Review the field list: detection can miss personal data.");
  }
  if (options.seed !== undefined) warnings.push("Seeded transformation is reproducible. Anyone with the seed could test guesses against pseudonyms.");
  if (integrity && !integrity.valid) warnings.push(`Referential integrity check found ${integrity.issues.length} issue(s) after transformation.`);
  return {
    mode: options.mode,
    seeded: options.seed !== undefined,
    collections: plans.map((p) => ({ name: p.name, records: dataset[p.name]?.length ?? 0, fields: Array.from(p.fields.values()) })),
    integrity,
    warnings,
    limitations: PRIVACY_LIMITATIONS,
  };
}
