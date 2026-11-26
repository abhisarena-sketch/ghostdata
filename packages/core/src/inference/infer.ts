import { classifyField, type PrivacyClassification } from "@workfonic/dataghost-privacy";
import type { FieldInput, SchemaInput } from "../schema.js";
import { detectSemantic, dominant, enumSuggestion, formatRate, isUnique, nonNull, numericSuggestion, dateRange, type GeneratorSuggestion } from "./semantic.js";
import { CollectionStats, type FieldAccumulator } from "./stats.js";

export type InferredType = "string" | "integer" | "number" | "boolean" | "date" | "timestamp" | "null" | "object" | "array" | "mixed";

export interface InferredField {
  /** Path within a record: "address.city", "items[].sku", "tags[]". */
  path: string;
  type: InferredType;
  /** Semantic meaning such as "email" or "employeeId", when detected. */
  semanticType?: string;
  /** 0..1 confidence in semanticType (or in the plain type when no semantic type). */
  confidence: number;
  nullable: boolean;
  nullRate: number;
  optional: boolean;
  presentRate: number;
  /** Structural example that does not reveal source values, e.g. "Xxxx-999" or "<email>". */
  example: string;
  suggestedGenerator?: GeneratorSuggestion;
  privacy?: PrivacyClassification;
  stats: {
    count: number;
    distinct?: number;
    unique?: boolean;
    minLength?: number;
    maxLength?: number;
    min?: number;
    max?: number;
    minItems?: number;
    maxItems?: number;
  };
  warnings: string[];
  overridden?: boolean;
}

export interface CollectionInference {
  name: string;
  recordCount: number;
  fieldCount: number;
  fields: InferredField[];
  /** A generation schema derived from the inferred fields. */
  schema: SchemaInput;
  warnings: string[];
}

export interface InferOptions {
  /** Per-path overrides applied to the derived schema, e.g. { "email": "email", "age": { type: "integer", min: 18, max: 65 } }. */
  overrides?: Record<string, FieldInput>;
  /** Collection name used for context (e.g. "departments" => "name" is a department). */
  name?: string;
}

function shape(value: string): string {
  let out = "";
  for (const ch of value.slice(0, 24)) {
    if (/[A-Z]/.test(ch)) out += "X";
    else if (/[a-z]/.test(ch)) out += "x";
    else if (/\d/.test(ch)) out += "9";
    else out += ch;
  }
  return value.length > 24 ? `${out}...` : out;
}

function leafType(acc: FieldAccumulator): { type: InferredType; mixed: boolean } {
  const t = acc.types;
  const kinds = (Object.entries(t) as [string, number][]).filter(([, n]) => n > 0).map(([k]) => k);
  const numericOnly = kinds.every((k) => k === "integer" || k === "number");
  const mixed = kinds.length > 1 && !numericOnly;
  const d = dominant(acc);
  if (d === "null") return { type: "null", mixed: false };
  if (d === "extended") {
    if (acc.extended?.$date) return { type: "timestamp", mixed };
    if (acc.extended?.$numberLong || acc.extended?.$numberInt) return { type: "integer", mixed };
    if (acc.extended?.$numberDecimal || acc.extended?.$numberDouble) return { type: "number", mixed };
    return { type: "string", mixed };
  }
  if (d === "string") {
    if (formatRate(acc, "date") >= 0.95) return { type: "date", mixed };
    if (formatRate(acc, "timestamp") >= 0.95) return { type: "timestamp", mixed };
    return { type: "string", mixed };
  }
  if (d === "number" || d === "integer") return { type: t.number > 0 ? "number" : "integer", mixed };
  return { type: d as InferredType, mixed };
}

function plainSuggestion(type: InferredType, acc: FieldAccumulator, sensitive: boolean): GeneratorSuggestion {
  switch (type) {
    case "integer":
    case "number": {
      if (!sensitive) {
        const e = enumSuggestion(acc);
        if (e && acc.distinct.size <= 6 && nonNull(acc) >= 20) return e;
      }
      return acc.num ? numericSuggestion(acc) : { type: "integer", options: {} };
    }
    case "boolean": {
      const b = acc.bool!;
      return { type: "boolean", options: { probability: Math.round((b.trues / b.count) * 1000) / 1000 } };
    }
    case "date":
      return dateRange(acc, "date");
    case "timestamp":
      return acc.extended?.$date ? { ...dateRange(acc, "timestamp") } : dateRange(acc, "timestamp");
    case "string": {
      if (!sensitive) {
        const e = enumSuggestion(acc);
        if (e) return e;
      }
      const s = acc.str!;
      if (s.maxLength > 60) return { type: "sentence", options: { minWords: Math.max(1, Math.floor(s.minLength / 7)), maxWords: Math.max(2, Math.ceil(s.maxLength / 6)) } };
      return { type: "string", options: { minLength: s.minLength === Infinity ? 0 : s.minLength, maxLength: Math.max(s.maxLength, s.minLength === Infinity ? 0 : s.minLength) } };
    }
    default:
      return { type: "null", options: {} };
  }
}

function exampleFor(type: InferredType, acc: FieldAccumulator, semantic: string | undefined, sensitive: boolean, enumCount?: number): string {
  if (sensitive) return `<${semantic ?? "sensitive"}>`;
  if (enumCount) return `<one of ${enumCount} values>`;
  switch (type) {
    case "string": {
      const first = acc.samples.find((v) => typeof v === "string") as string | undefined;
      return first !== undefined ? shape(first) : "<string>";
    }
    case "integer":
    case "number":
      return acc.num ? `<${type} ${acc.num.min}..${acc.num.max}>` : `<${type}>`;
    case "date":
      return "9999-99-99";
    case "timestamp":
      return acc.extended?.$date ? '{"$date": "9999-99-99T99:99:99Z"}' : "9999-99-99T99:99:99Z";
    case "boolean":
      return "<boolean>";
    default:
      return `<${type}>`;
  }
}

const round = (n: number, d = 3) => Math.round(n * 10 ** d) / 10 ** d;

function buildFields(acc: FieldAccumulator, path: string, key: string, parentKey: string, collection: string, out: InferredField[]): FieldInput | undefined {
  const count = nonNull(acc);
  const presentRate = acc.parents > 0 ? acc.present / acc.parents : 1;
  const nullRate = acc.present > 0 ? acc.nulls / acc.present : 0;
  const common = {
    nullable: acc.nulls > 0,
    nullRate: round(nullRate),
    optional: presentRate < 1,
    presentRate: round(presentRate),
  };
  const specExtras = (spec: Record<string, unknown>): FieldInput => {
    if (common.nullable) spec.nullable = Math.max(0.001, round(nullRate));
    if (common.optional) spec.optional = Math.max(0.001, round(1 - presentRate));
    return spec as unknown as FieldInput;
  };
  const warnings: string[] = [];
  const kindsSeen = (["object", "array"] as const).filter((k) => acc.types[k] > 0);
  const scalarSeen = acc.types.string + acc.types.integer + acc.types.number + acc.types.boolean + acc.types.extended;

  // Object
  if (acc.obj && acc.types.object >= scalarSeen && acc.types.object >= acc.types.array) {
    if (scalarSeen > 0 || acc.types.array > 0) warnings.push(`Mixed types: object in ${acc.types.object} records, other types in ${scalarSeen + acc.types.array}`);
    const field: InferredField = { path, type: "object", confidence: 1, ...common, example: "{...}", stats: { count }, warnings };
    out.push(field);
    const fields: SchemaInput = {};
    for (const k of acc.obj.order) {
      const child = acc.obj.children.get(k)!;
      const f = buildFields(child, path ? `${path}.${k}` : k, k, key, collection, out);
      if (f !== undefined) fields[k] = f;
    }
    if (Object.keys(fields).length === 0) return specExtras({ type: "constant", value: {} });
    return specExtras({ type: "object", fields });
  }
  // Array
  if (acc.arr && acc.types.array >= scalarSeen) {
    if (scalarSeen > 0 || acc.types.object > 0) warnings.push("Mixed types: array in some records, other types in others");
    const a = acc.arr;
    const field: InferredField = { path, type: "array", confidence: 1, ...common, example: "[...]", stats: { count, minItems: a.minLength, maxItems: a.maxLength }, warnings };
    out.push(field);
    const items = a.items.present > 0 ? buildFields(a.items, `${path}[]`, key, key, collection, out) : { type: "string" };
    return specExtras({ type: "array", items: items ?? { type: "string" }, minItems: a.minLength, maxItems: a.maxLength });
  }
  void kindsSeen;

  // Leaf
  const { type, mixed } = leafType(acc);
  if (mixed) {
    const kinds = (Object.entries(acc.types) as [string, number][]).filter(([, n]) => n > 0).map(([k, n]) => `${k} (${n})`);
    warnings.push(`Mixed value types: ${kinds.join(", ")}. Generating the most common type.`);
  }
  const privacyPath = parentKey ? `${parentKey}.${key}` : `${collection}.${key}`;
  const privacy = type === "null" ? undefined : classifyField({ path: privacyPath, samples: acc.samples });
  const sensitive = !!privacy && privacy.level !== "none" && privacy.level !== "low";
  const semantic = type === "null" ? undefined : detectSemantic(key, parentKey || collection, acc, privacy);
  let suggestion = semantic?.generator ?? plainSuggestion(type, acc, sensitive || privacy?.category === "identifier");
  // Unique identifiers that look sequential keep uniqueness when generated.
  const unique = isUnique(acc) && count >= 2 && (type === "string" || type === "integer");
  if (type === "integer" && unique && /id$|no$|number$|key$/i.test(key) && acc.num && acc.num.min >= 0) {
    suggestion = { type: "sequence", options: { start: acc.num.min } };
  }
  if (unique && suggestion.type === "pattern") {
    warnings.push("Values are unique in the source; the suggested pattern generator may produce duplicates. Mark the field unique: true if required.");
  }
  if (privacy?.uncertain) warnings.push(...privacy.warnings);
  if (count === 0) warnings.push("Field is always null or missing in the source.");
  else if (count < 5) warnings.push(`Only ${count} non-null value(s) observed; inferred type may be unreliable.`);

  const enumCount = suggestion.type === "enum" ? (suggestion.options.values as unknown[]).length : undefined;
  const isSecret = privacy?.level === "secret";
  if (isSecret && suggestion.type !== "secret") suggestion = { type: "secret", options: {} };

  const stats: InferredField["stats"] = { count, distinct: acc.distinctOverflow ? undefined : acc.distinct.size, unique };
  if (acc.str && acc.str.count) {
    stats.minLength = acc.str.minLength;
    stats.maxLength = acc.str.maxLength;
  }
  if (acc.num && !sensitive) {
    stats.min = acc.num.min;
    stats.max = acc.num.max;
  }
  const field: InferredField = {
    path,
    type,
    semanticType: semantic?.semanticType,
    confidence: semantic ? semantic.confidence : mixed ? 0.5 : count >= 5 ? 0.9 : 0.6,
    ...common,
    example: exampleFor(type, acc, semantic?.semanticType ?? privacy?.category, sensitive || isSecret, enumCount),
    suggestedGenerator: suggestion,
    privacy: privacy && privacy.level !== "none" ? privacy : undefined,
    stats,
    warnings,
  };
  // Enum values are learned from the source; never expose them for sensitive fields.
  if (enumCount && sensitive) {
    field.suggestedGenerator = plainSuggestion(type, acc, true);
  }
  out.push(field);
  const spec: Record<string, unknown> = { type: field.suggestedGenerator!.type, ...field.suggestedGenerator!.options };
  const keyLike = /(^id$|_id$|Id$|ID$|key$|Key$|code$|Code$|number$|Number$|_no$|ref$|Ref$|uuid$|Uuid$)/.test(key) || ["email", "username", "uuid", "objectId", "identifier"].includes(semantic?.semanticType ?? "");
  if (unique && keyLike && !["sequence", "employeeId"].includes(spec.type as string) && type !== "integer") spec.unique = true;
  if (acc.extended?.$date) spec.wrap = "$date";
  else if (acc.extended?.$oid && spec.type !== "objectId") spec.wrap = "$oid";
  return specExtras(spec);
}

/** Apply path overrides ("a.b", "items[].sku") to a schema in place. */
export function applyOverrides(schema: SchemaInput, overrides: Record<string, FieldInput>, fields?: InferredField[]): string[] {
  const missing: string[] = [];
  for (const [path, override] of Object.entries(overrides)) {
    const parts = path.split(".");
    let node: Record<string, unknown> = schema as Record<string, unknown>;
    let ok = true;
    for (let i = 0; i < parts.length; i++) {
      const raw = parts[i]!;
      const each = raw.endsWith("[]");
      const key = each ? raw.slice(0, -2) : raw;
      if (key === "__proto__" || key === "constructor" || key === "prototype") {
        ok = false;
        break;
      }
      const last = i === parts.length - 1;
      if (last && !each) {
        node[key] = override;
        break;
      }
      let next = node[key] as Record<string, unknown> | undefined;
      if (!next || typeof next !== "object") {
        if (last) {
          node[key] = override;
          break;
        }
        ok = false;
        break;
      }
      if (next.type === "object") next = next.fields as Record<string, unknown>;
      if (each) {
        if ((next as Record<string, unknown>).type !== "array") {
          ok = false;
          break;
        }
        if (last) {
          (next as Record<string, unknown>).items = override;
          break;
        }
        next = (next as Record<string, unknown>).items as Record<string, unknown>;
        if (next && (next as Record<string, unknown>).type === "object") next = (next as Record<string, unknown>).fields as Record<string, unknown>;
      }
      node = next as Record<string, unknown>;
    }
    if (!ok) missing.push(path);
    const f = fields?.find((x) => x.path === path);
    if (f && ok) {
      f.overridden = true;
      f.suggestedGenerator = typeof override === "string" ? { type: override, options: {} } : (override as { type?: string }).type ? { type: (override as { type: string }).type, options: Object.fromEntries(Object.entries(override).filter(([k]) => k !== "type")) } : f.suggestedGenerator;
    }
  }
  return missing;
}

/** Infer a collection's structure from accumulated statistics. */
export function inferFromStats(stats: CollectionStats, options: InferOptions = {}): CollectionInference {
  const name = options.name ?? "records";
  const fields: InferredField[] = [];
  const schema: SchemaInput = {};
  const warnings: string[] = [];
  const root = stats.root;
  if (stats.skipped) warnings.push(`${stats.skipped} non-object value(s) were skipped.`);
  if (root.obj) {
    for (const k of root.obj.order) {
      const f = buildFields(root.obj.children.get(k)!, k, k, "", name, fields);
      if (f !== undefined) schema[k] = f;
    }
  }
  if (stats.records < 5 && stats.records > 0) {
    warnings.push(`Only ${stats.records} record(s) analysed. Use more records for more reliable inference.`);
    // The collection-level warning covers every field; avoid repeating it per field.
    for (const f of fields) f.warnings = f.warnings.filter((w) => !w.startsWith("Only "));
  }
  if (options.overrides) {
    const missing = applyOverrides(schema, options.overrides, fields);
    for (const m of missing) warnings.push(`Override path "${m}" did not match the inferred schema.`);
  }
  const leafCount = fields.filter((f) => f.type !== "object" && f.type !== "array").length;
  return { name, recordCount: stats.records, fieldCount: leafCount, fields, schema, warnings };
}

/** Infer a schema from an array of records. */
export function inferSchema(records: Iterable<unknown>, options: InferOptions = {}): CollectionInference {
  const stats = new CollectionStats();
  for (const r of records) stats.add(r);
  return inferFromStats(stats, options);
}
