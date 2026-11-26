import { scanRecord, type SafetyFinding } from "@workfonic/dataghost-privacy";
import { validateIntegrity, type IntegrityReport, type RelationshipConfig } from "@workfonic/dataghost-relationships";
import type { DataRecord, Dataset } from "./engine.js";
import type { NormalizedField, NormalizedObject } from "./schema.js";

export interface ValidationIssue {
  collection?: string;
  recordIndex: number;
  path: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  checked: number;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  truncated: boolean;
}

const MAX_ISSUES = 200;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

function typeOf(v: unknown): string {
  return v === null ? "null" : Array.isArray(v) ? "array" : typeof v;
}

function checkLeaf(field: Extract<NormalizedField, { kind: "leaf" }>, v: unknown): string | undefined {
  const o = field.options as Record<string, unknown>;
  const range = (n: number) => {
    if (typeof o.min === "number" && n < o.min) return `value ${n} is below min ${o.min}`;
    if (typeof o.max === "number" && n > o.max) return `value ${n} is above max ${o.max}`;
    return undefined;
  };
  if (field.generator === "enum") {
    const values = o.values as unknown[];
    return values.some((x) => x === v) ? undefined : `value is not one of the ${values.length} allowed values`;
  }
  if (field.generator === "constant") return undefined;
  switch (field.output) {
    case "string":
      return typeof v === "string" ? undefined : `expected string, got ${typeOf(v)}`;
    case "integer":
      return typeof v === "number" && Number.isInteger(v) ? range(v) : `expected integer, got ${typeOf(v)}`;
    case "number":
      return typeof v === "number" && Number.isFinite(v) ? range(v) : `expected number, got ${typeOf(v)}`;
    case "boolean":
      return typeof v === "boolean" ? undefined : `expected boolean, got ${typeOf(v)}`;
    case "date":
      return typeof v === "string" && DATE.test(v) && !Number.isNaN(Date.parse(v)) ? undefined : "expected a YYYY-MM-DD date";
    case "timestamp":
      if (typeof v === "number") return Number.isFinite(v) ? undefined : "expected a timestamp";
      return typeof v === "string" && ISO.test(v) ? undefined : "expected an ISO 8601 timestamp";
    case "object":
      return v !== null && typeof v === "object" && !Array.isArray(v) ? undefined : `expected object, got ${typeOf(v)}`;
    default:
      return undefined;
  }
}

/** Validate records against a normalised schema: presence, nullability, types, ranges, enums and uniqueness. */
export function validateRecords(records: readonly DataRecord[], schema: NormalizedObject, collection?: string): ValidationResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  let truncated = false;
  const err = (i: ValidationIssue) => (errors.length < MAX_ISSUES ? errors.push(i) : (truncated = true));
  const warn = (i: ValidationIssue) => (warnings.length < MAX_ISSUES ? warnings.push(i) : (truncated = true));
  const uniques = new Map<string, Set<string>>();

  const check = (field: NormalizedField, value: unknown, path: string, index: number) => {
    if (value === null) {
      if (field.nullRate === 0) err({ collection, recordIndex: index, path, message: "null is not allowed (field is not nullable)" });
      return;
    }
    let v: unknown = value;
    if (field.wrap) {
      if (v === null || typeof v !== "object" || !(field.wrap in (v as object))) {
        err({ collection, recordIndex: index, path, message: `expected {"${field.wrap}": ...}` });
        return;
      }
      v = (v as Record<string, unknown>)[field.wrap];
    }
    if (field.kind === "object") {
      if (v === null || typeof v !== "object" || Array.isArray(v)) {
        err({ collection, recordIndex: index, path, message: `expected object, got ${typeOf(v)}` });
        return;
      }
      checkObject(field, v as DataRecord, path, index);
      return;
    }
    if (field.kind === "array") {
      if (!Array.isArray(v)) {
        err({ collection, recordIndex: index, path, message: `expected array, got ${typeOf(v)}` });
        return;
      }
      if (v.length < field.minItems || v.length > field.maxItems) err({ collection, recordIndex: index, path, message: `array length ${v.length} outside ${field.minItems}..${field.maxItems}` });
      v.forEach((el, i) => check(field.items, el, `${path}[${i}]`, index));
      return;
    }
    const problem = checkLeaf(field, v);
    if (problem) err({ collection, recordIndex: index, path, message: problem });
    if (field.unique) {
      const key = path.replace(/\[\d+\]/g, "[]");
      let set = uniques.get(key);
      if (!set) uniques.set(key, (set = new Set()));
      const k = typeof v === "string" ? v : JSON.stringify(v);
      if (set.has(k)) err({ collection, recordIndex: index, path, message: "duplicate value in a unique field" });
      set.add(k);
    }
  };

  const checkObject = (node: NormalizedObject, obj: DataRecord, path: string, index: number) => {
    const known = new Set<string>();
    for (const [k, f] of node.fields) {
      known.add(k);
      const p = path ? `${path}.${k}` : k;
      if (!(k in obj)) {
        if (f.missingRate === 0) err({ collection, recordIndex: index, path: p, message: "required field is missing" });
        continue;
      }
      check(f, obj[k], p, index);
    }
    for (const k of Object.keys(obj)) if (!known.has(k)) warn({ collection, recordIndex: index, path: path ? `${path}.${k}` : k, message: "field is not in the schema" });
  };

  records.forEach((r, i) => {
    if (r === null || typeof r !== "object" || Array.isArray(r)) err({ collection, recordIndex: i, path: "", message: "record is not an object" });
    else checkObject(schema, r, "", i);
  });
  return { valid: errors.length === 0, checked: records.length, errors, warnings, truncated };
}

export interface DatasetValidation {
  valid: boolean;
  schema: Record<string, ValidationResult>;
  integrity?: IntegrityReport;
  safety: SafetyFinding[];
  safetyTruncated: boolean;
}

/** Validate a dataset: per-collection schema checks, referential integrity and a safety scan for real-looking values. */
export function validateDatasetFull(
  dataset: Dataset,
  options: { schemas?: Record<string, NormalizedObject>; relationships?: RelationshipConfig[]; safetyScan?: boolean } = {},
): DatasetValidation {
  const schema: Record<string, ValidationResult> = {};
  for (const [name, s] of Object.entries(options.schemas ?? {})) {
    schema[name] = validateRecords(dataset[name] ?? [], s, name);
  }
  const integrity = options.relationships?.length ? validateIntegrity(dataset, options.relationships) : undefined;
  const safety: SafetyFinding[] = [];
  let safetyTruncated = false;
  if (options.safetyScan !== false) {
    outer: for (const [name, records] of Object.entries(dataset)) {
      for (let i = 0; i < records.length; i++) {
        for (const f of scanRecord(records[i], `${name}[${i}]`)) {
          if (safety.length >= MAX_ISSUES) {
            safetyTruncated = true;
            break outer;
          }
          safety.push(f);
        }
      }
    }
  }
  const valid = Object.values(schema).every((r) => r.valid) && (integrity?.valid ?? true) && safety.length === 0;
  return { valid, schema, integrity, safety, safetyTruncated };
}
