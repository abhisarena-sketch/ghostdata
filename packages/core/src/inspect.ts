import { GENERATOR_VERSION } from "@workfonic/dataghost-generators";
import { defaultTransformation, PRIVACY_LIMITATIONS, type SensitiveCategory, type SensitivityLevel, type Transformation } from "@workfonic/dataghost-privacy";
import { detectRelationships, type RelationshipConfig, type SuggestedRelationship } from "@workfonic/dataghost-relationships";
import type { Dataset } from "./engine.js";
import { inferFromStats, type CollectionInference } from "./inference/infer.js";
import { CollectionStats } from "./inference/stats.js";
import type { FieldInput } from "./schema.js";

export interface PrivacyFieldSummary {
  collection: string;
  path: string;
  category: SensitiveCategory;
  level: SensitivityLevel;
  confidence: number;
  uncertain: boolean;
  /** Transformation that mask mode applies by default. */
  defaultTransformation: Transformation;
  reasons: string[];
  warnings: string[];
}

export interface InspectionReport {
  generatorVersion: string;
  collections: CollectionInference[];
  /** Relationships detected from the data (suggestions; review before relying on them). */
  relationships: SuggestedRelationship[];
  privacy: {
    fields: PrivacyFieldSummary[];
    warnings: string[];
    limitations: readonly string[];
  };
  totals: { collections: number; records: number; fields: number; sensitiveFields: number; uncertainFields: number };
}

/** Overrides keyed by collection, then field path. For single-collection data, bare paths are accepted too. */
export type OverrideMap = Record<string, Record<string, FieldInput> | FieldInput>;

export interface InspectOptions {
  overrides?: OverrideMap;
  /** Detect relationships between collections (default true). */
  detectRelationships?: boolean;
  /** Only suggest relationships at or above this confidence (default 0.6). */
  relationshipThreshold?: number;
}

export function overridesFor(collection: string, collections: string[], overrides: OverrideMap | undefined): Record<string, FieldInput> | undefined {
  if (!overrides) return undefined;
  const scoped = overrides[collection];
  const out: Record<string, FieldInput> = {};
  if (scoped && typeof scoped === "object" && !("type" in scoped && typeof (scoped as { type: unknown }).type === "string")) Object.assign(out, scoped);
  if (collections.length === 1) {
    for (const [k, v] of Object.entries(overrides)) if (!collections.includes(k)) out[k] = v as FieldInput;
  }
  return Object.keys(out).length ? out : undefined;
}

/** Summarise privacy findings of inferred collections. */
export function summarizePrivacy(collections: CollectionInference[]): InspectionReport["privacy"] {
  const fields: PrivacyFieldSummary[] = [];
  const warnings: string[] = [];
  for (const c of collections) {
    for (const f of c.fields) {
      const p = f.privacy;
      if (!p || !p.category || p.level === "none") continue;
      fields.push({
        collection: c.name,
        path: f.path,
        category: p.category,
        level: p.level,
        confidence: p.confidence,
        uncertain: p.uncertain,
        defaultTransformation: defaultTransformation(p.category),
        reasons: p.detections[0]?.reasons ?? [],
        warnings: p.warnings,
      });
    }
  }
  const quasi = fields.filter((f) => f.category === "quasiIdentifier");
  if (quasi.length >= 2) warnings.push(`${quasi.length} quasi-identifiers (${quasi.map((q) => q.path).join(", ")}) could re-identify people in combination.`);
  const uncertain = fields.filter((f) => f.uncertain);
  if (uncertain.length) warnings.push(`${uncertain.length} field(s) have uncertain classifications and need review.`);
  return { fields, warnings, limitations: PRIVACY_LIMITATIONS };
}

/** Inspect a dataset: infer each collection's schema, detect relationships and potential sensitive fields. */
export function inspectDataset(dataset: Dataset, options: InspectOptions = {}): InspectionReport {
  const names = Object.keys(dataset);
  const collections = names.map((name) => {
    const stats = new CollectionStats();
    for (const r of dataset[name]!) stats.add(r);
    return inferFromStats(stats, { name, overrides: overridesFor(name, names, options.overrides) });
  });
  return buildReport(collections, options.detectRelationships === false ? [] : detectRelationships(dataset), options.relationshipThreshold);
}

/** Build a report from collection inferences (e.g. produced by streaming statistics). */
export function buildReport(collections: CollectionInference[], relationships: SuggestedRelationship[], threshold = 0.6): InspectionReport {
  const privacy = summarizePrivacy(collections);
  const rels = relationships.filter((r) => r.confidence >= threshold);
  return {
    generatorVersion: GENERATOR_VERSION,
    collections,
    relationships: rels,
    privacy,
    totals: {
      collections: collections.length,
      records: collections.reduce((n, c) => n + c.recordCount, 0),
      fields: collections.reduce((n, c) => n + c.fieldCount, 0),
      sensitiveFields: privacy.fields.filter((f) => f.level !== "low").length,
      uncertainFields: privacy.fields.filter((f) => f.uncertain).length,
    },
  };
}

/** Convert suggestions to plain relationship configs (drops detection metadata). */
export function toRelationshipConfigs(suggestions: readonly SuggestedRelationship[]): RelationshipConfig[] {
  return suggestions.map((s) => {
    const r: RelationshipConfig = { from: s.from, to: s.to, type: s.type };
    if (s.nullable) r.nullable = s.nullable;
    return r;
  });
}
