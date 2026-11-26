import { GeneratorOptionsError, type GeneratorFn, type GeneratorRegistry } from "@workfonic/dataghost-generators";
import { parsePath, type PathSegment } from "@workfonic/dataghost-relationships";
import { InvalidSchemaError } from "./errors.js";

/** Options shared by every field spec. */
export interface CommonFieldOptions {
  /** true (10% nulls) or a probability between 0 and 1. */
  nullable?: boolean | number;
  /** true (10% missing) or a probability that the key is absent. */
  optional?: boolean | number;
  /** Reject duplicate values within the collection. */
  unique?: boolean;
  /** Wrap the value as {"<wrap>": value}, e.g. "$date" or "$oid" for MongoDB extended JSON. */
  wrap?: string;
  description?: string;
}

/** A generator-backed field: { type: "integer", min: 1, max: 10 }. */
export interface LeafFieldSpec extends CommonFieldOptions {
  type: string;
  [option: string]: unknown;
}

export interface ObjectFieldSpec extends CommonFieldOptions {
  type: "object";
  fields: SchemaInput;
}

export interface ArrayFieldSpec extends CommonFieldOptions {
  type: "array";
  items: FieldInput;
  /** Exact length (shorthand for minItems = maxItems = length). */
  length?: number;
  minItems?: number;
  maxItems?: number;
}

/** SDK-only: a function generator. Not accepted from config files or the playground. */
export interface CustomFieldSpec extends CommonFieldOptions {
  type: "custom";
  generate: GeneratorFn<any>;
}

export type FieldSpec = LeafFieldSpec | ObjectFieldSpec | ArrayFieldSpec | CustomFieldSpec;

/**
 * A field is a generator name ("email"), a spec object ({ type: "integer", min: 1 }),
 * or a nested object of fields (shorthand for { type: "object", fields }).
 */
export type FieldInput = string | FieldSpec | SchemaInput;

export interface SchemaInput {
  [field: string]: FieldInput;
}

interface BaseNormalized {
  nullRate: number;
  missingRate: number;
  wrap?: string;
  description?: string;
}

export interface NormalizedLeaf extends BaseNormalized {
  kind: "leaf";
  generator: string;
  options: Record<string, unknown>;
  unique: boolean;
  output: string;
  fn?: GeneratorFn<any>;
}

export interface NormalizedObject extends BaseNormalized {
  kind: "object";
  fields: [string, NormalizedField][];
}

export interface NormalizedArray extends BaseNormalized {
  kind: "array";
  items: NormalizedField;
  minItems: number;
  maxItems: number;
}

export type NormalizedField = NormalizedLeaf | NormalizedObject | NormalizedArray;

const COMMON_KEYS = new Set(["type", "nullable", "optional", "unique", "wrap", "description"]);
const FORBIDDEN_FIELD_NAMES = new Set(["__proto__", "constructor", "prototype"]);
const MAX_DEPTH = 32;
const MAX_ARRAY_ITEMS = 10_000;
/** Generators whose values derive from the record index and are unique by construction. */
export const INDEX_UNIQUE_GENERATORS = new Set(["employeeId", "sequence"]);

function rate(value: unknown, path: string, key: string): number {
  if (value === undefined || value === false) return 0;
  if (value === true) return 0.1;
  if (typeof value === "number" && value >= 0 && value <= 1) return value;
  throw new InvalidSchemaError(`"${key}" at "${path}" must be a boolean or a probability between 0 and 1`, path);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v) && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);
}

function joinPath(base: string, key: string): string {
  return base ? `${base}.${key}` : key;
}

export interface NormalizeOptions {
  registry: GeneratorRegistry;
  /** Allow `type: "custom"` function generators (SDK only). */
  allowFunctions?: boolean;
}

/** Normalise a schema into the internal representation, validating every field and generator option. */
export function normalizeSchema(schema: SchemaInput, options: NormalizeOptions): NormalizedObject {
  if (!isPlainObject(schema)) throw new InvalidSchemaError("Schema must be an object mapping field names to field definitions", "");
  if (Object.keys(schema).length === 0) throw new InvalidSchemaError("Schema has no fields", "");
  return normalizeObject(schema, "", options, 0, { nullRate: 0, missingRate: 0 });
}

function normalizeObject(fields: SchemaInput, path: string, o: NormalizeOptions, depth: number, base: BaseNormalized): NormalizedObject {
  if (depth > MAX_DEPTH) throw new InvalidSchemaError(`Schema nesting deeper than ${MAX_DEPTH} levels at "${path}"`, path);
  if (!isPlainObject(fields)) throw new InvalidSchemaError(`"fields" at "${path || "(root)"}" must be an object`, path);
  const out: [string, NormalizedField][] = [];
  for (const [key, value] of Object.entries(fields)) {
    if (FORBIDDEN_FIELD_NAMES.has(key)) throw new InvalidSchemaError(`Field name "${key}" is not allowed`, joinPath(path, key));
    if (key.length === 0 || key.length > 256) throw new InvalidSchemaError(`Field names must be 1-256 characters (at "${path || "(root)"}")`, path);
    if (/[.[\]]/.test(key)) throw new InvalidSchemaError(`Field name "${key}" cannot contain ".", "[" or "]"`, joinPath(path, key));
    out.push([key, normalizeField(value, joinPath(path, key), o, depth + 1)]);
  }
  return { kind: "object", fields: out, ...base };
}

export function normalizeField(input: FieldInput, path: string, o: NormalizeOptions, depth = 0): NormalizedField {
  if (typeof input === "string") return leaf(input, {}, path, o, { nullRate: 0, missingRate: 0 }, false);
  if (!isPlainObject(input)) throw new InvalidSchemaError(`Field "${path}" must be a generator name, a field spec or a nested object`, path);
  const spec = input as Record<string, unknown>;
  if (typeof spec.type !== "string") {
    // Nested object shorthand.
    return normalizeObject(spec as SchemaInput, path, o, depth, { nullRate: 0, missingRate: 0 });
  }
  const base: BaseNormalized = { nullRate: rate(spec.nullable, path, "nullable"), missingRate: rate(spec.optional, path, "optional") };
  if (spec.wrap !== undefined) {
    if (typeof spec.wrap !== "string" || !/^\$?[A-Za-z][A-Za-z0-9_]{0,31}$/.test(spec.wrap)) throw new InvalidSchemaError(`"wrap" at "${path}" must be a key such as "$date"`, path);
    base.wrap = spec.wrap;
  }
  if (typeof spec.description === "string") base.description = spec.description;
  const unique = spec.unique === true;

  if (spec.type === "object") {
    const extra = Object.keys(spec).filter((k) => !COMMON_KEYS.has(k) && k !== "fields");
    if (extra.length) throw new InvalidSchemaError(`Unknown option(s) ${extra.join(", ")} for object field "${path}"`, path);
    if (spec.fields === undefined) throw new InvalidSchemaError(`Object field "${path}" needs "fields"`, path);
    return normalizeObject(spec.fields as SchemaInput, path, o, depth, base);
  }
  if (spec.type === "array") {
    const extra = Object.keys(spec).filter((k) => !COMMON_KEYS.has(k) && !["items", "length", "minItems", "maxItems"].includes(k));
    if (extra.length) throw new InvalidSchemaError(`Unknown option(s) ${extra.join(", ")} for array field "${path}"`, path);
    if (spec.items === undefined) throw new InvalidSchemaError(`Array field "${path}" needs "items"`, path);
    const len = spec.length;
    let min = (len ?? spec.minItems ?? 0) as number;
    let max = (len ?? spec.maxItems ?? Math.max(min, 3)) as number;
    for (const [k, v] of [["minItems", min], ["maxItems", max]] as const) {
      if (!Number.isInteger(v) || v < 0 || v > MAX_ARRAY_ITEMS) throw new InvalidSchemaError(`"${k}" at "${path}" must be an integer between 0 and ${MAX_ARRAY_ITEMS}`, path);
    }
    if (max < min) throw new InvalidSchemaError(`"maxItems" must be >= "minItems" at "${path}"`, path);
    min = Math.floor(min);
    max = Math.floor(max);
    return { kind: "array", items: normalizeField(spec.items as FieldInput, `${path}[]`, o, depth + 1), minItems: min, maxItems: max, ...base };
  }
  if (spec.type === "custom") {
    if (!o.allowFunctions) {
      throw new InvalidSchemaError(`Field "${path}" uses a custom function generator, which is only available in the SDK`, path);
    }
    if (typeof spec.generate !== "function") throw new InvalidSchemaError(`Custom field "${path}" needs a "generate" function`, path);
    return { kind: "leaf", generator: "custom", options: {}, unique, output: "any", fn: spec.generate as GeneratorFn<any>, ...base };
  }
  const opts: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(spec)) if (!COMMON_KEYS.has(k)) opts[k] = v;
  return leaf(spec.type, opts, path, o, base, unique);
}

function leaf(type: string, options: Record<string, unknown>, path: string, o: NormalizeOptions, base: BaseNormalized, unique: boolean): NormalizedLeaf {
  if (type === "object" || type === "array") throw new InvalidSchemaError(`"${type}" fields need a spec object (at "${path}")`, path);
  if (type === "custom") throw new InvalidSchemaError(`"custom" fields need a spec object with a generate function (at "${path}")`, path);
  for (const v of Object.values(options)) {
    if (typeof v === "function" && !o.allowFunctions) throw new InvalidSchemaError(`Functions are not allowed in options at "${path}"`, path);
  }
  const def = o.registry.get(type);
  try {
    const parsed = o.registry.parseOptions(type, options, path);
    return { kind: "leaf", generator: def!.name, options: parsed, unique, output: def!.output, ...base };
  } catch (e) {
    if (e instanceof GeneratorOptionsError) throw new InvalidSchemaError(e.message, path, e.issues);
    throw e;
  }
}

/** Find the normalised field at a path ("a.b", "items[].sku"), or undefined. */
export function fieldAtPath(root: NormalizedObject, path: string | PathSegment[]): NormalizedField | undefined {
  const segs = typeof path === "string" ? parsePath(path) : path;
  let node: NormalizedField = root;
  for (const seg of segs) {
    if (node.kind !== "object") return undefined;
    const next: NormalizedField | undefined = node.fields.find(([k]) => k === seg.key)?.[1];
    if (!next) return undefined;
    if (seg.each) {
      if (next.kind !== "array") return undefined;
      node = next.items;
    } else node = next;
  }
  return node;
}

/** List leaf paths of a normalised schema (arrays as "[]"). */
export function leafPaths(root: NormalizedField, prefix = ""): { path: string; field: NormalizedLeaf }[] {
  if (root.kind === "leaf") return [{ path: prefix, field: root }];
  if (root.kind === "array") return leafPaths(root.items, `${prefix}[]`);
  const out: { path: string; field: NormalizedLeaf }[] = [];
  for (const [k, f] of root.fields) out.push(...leafPaths(f, prefix ? `${prefix}.${k}` : k));
  return out;
}
