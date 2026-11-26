import type { RelationshipConfig, RelationshipType } from "./relationships.js";

type Rec = Record<string, unknown>;

export interface SuggestedRelationship extends RelationshipConfig {
  from: string;
  to: string;
  type: RelationshipType;
  /** 0..1: how confident the detector is. */
  confidence: number;
  /** Share of non-null references that matched a parent key. */
  coverage: number;
  reason: string;
}

const ID_NAME = /(^id$|_id$|Id$|ID$|_key$|Key$|_ref$|Ref$|_code$|Code$|^key$|^code$|^uuid$|_uuid$|Uuid$)/;
const MAX_SCAN = 20_000;

function singular(name: string): string {
  const n = name.toLowerCase();
  if (n.endsWith("ies")) return n.slice(0, -3) + "y";
  if (n.endsWith("ses") || n.endsWith("xes")) return n.slice(0, -2);
  if (n.endsWith("s")) return n.slice(0, -1);
  return n;
}

function normalizeName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Strip a key/id suffix: "departmentId" -> "department", "manager_id" -> "manager". */
function stem(field: string): string {
  return normalizeName(field.replace(/(_?(id|key|ref|code|uuid))$/i, ""));
}

function isScalarKey(v: unknown): v is string | number {
  return (typeof v === "string" && v.length > 0 && v.length <= 200) || (typeof v === "number" && Number.isFinite(v));
}

/** Collect scalar leaf paths (with [] for arrays of objects) from sample records. */
function scalarPaths(records: readonly Rec[]): string[] {
  const paths = new Set<string>();
  const walk = (node: unknown, prefix: string, depth: number) => {
    if (depth > 6 || node === null || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const el of node.slice(0, 20)) walk(el, prefix + "[]", depth + 1);
      return;
    }
    for (const [k, v] of Object.entries(node as Rec)) {
      const p = prefix ? `${prefix}.${k}` : k;
      if (isScalarKey(v)) paths.add(p);
      else if (Array.isArray(v) && v.length > 0 && v.every(isScalarKey)) paths.add(`${p}[]`);
      else walk(v, p, depth + 1);
    }
  };
  for (const r of records.slice(0, 500)) walk(r, "", 0);
  return Array.from(paths);
}

function valuesAt(record: Rec, path: string): unknown[] {
  const out: unknown[] = [];
  const parts = path.split(".");
  const walk = (node: unknown, i: number) => {
    if (i === parts.length) {
      out.push(node);
      return;
    }
    if (node === null || typeof node !== "object" || Array.isArray(node)) return;
    const part = parts[i] as string;
    const each = part.endsWith("[]");
    const key = each ? part.slice(0, -2) : part;
    const v = (node as Rec)[key];
    if (each) {
      if (Array.isArray(v)) for (const el of v) walk(el, i + 1);
    } else walk(v, i + 1);
  };
  walk(record, 0);
  return out;
}

interface KeyCandidate {
  collection: string;
  path: string;
  keys: Set<string>;
  numeric: boolean;
}

function k(v: unknown): string {
  return typeof v === "number" ? `n:${v}` : `s:${String(v)}`;
}

/**
 * Detect likely relationships in a multi-collection dataset by comparing
 * identifier-like fields with unique key fields of other (or the same)
 * collections. All analysis is local and in memory.
 */
export function detectRelationships(dataset: Record<string, readonly Rec[]>): SuggestedRelationship[] {
  const collections = Object.entries(dataset).filter(([, recs]) => Array.isArray(recs) && recs.length > 0);

  // 1. Unique, always-present, top-level key candidates.
  const keys: KeyCandidate[] = [];
  for (const [name, recs] of collections) {
    const sample = recs.slice(0, MAX_SCAN);
    for (const path of scalarPaths(sample)) {
      if (path.includes(".") || path.includes("[]")) continue;
      if (!ID_NAME.test(path) && path !== "_id") continue;
      const set = new Set<string>();
      let ok = true;
      let numeric = true;
      for (const r of sample) {
        const v = r[path];
        if (!isScalarKey(v)) {
          ok = false;
          break;
        }
        if (typeof v !== "number") numeric = false;
        const key = k(v);
        if (set.has(key)) {
          ok = false;
          break;
        }
        set.add(key);
      }
      if (ok && set.size >= 1) keys.push({ collection: name, path, keys: set, numeric });
    }
  }

  // 2. Foreign-key candidates: id-like fields whose values fall inside a key set.
  const suggestions: SuggestedRelationship[] = [];
  for (const [name, recs] of collections) {
    const sample = recs.slice(0, MAX_SCAN);
    for (const path of scalarPaths(sample)) {
      const leaf = (path.split(".").pop() as string).replace(/\[\]$/, "");
      if (!ID_NAME.test(leaf)) continue;
      const values: unknown[] = [];
      for (const r of sample) for (const v of valuesAt(r, path)) if (v !== null && v !== undefined) values.push(v);
      if (values.length === 0) continue;

      let best: SuggestedRelationship | undefined;
      for (const key of keys) {
        if (key.collection === name && key.path === path) continue;
        let hits = 0;
        for (const v of values) if (key.keys.has(k(v))) hits++;
        const coverage = hits / values.length;
        if (coverage < 0.95) continue;

        const fieldStem = stem(leaf);
        const keyStem = stem(key.path);
        const collStem = normalizeName(singular(key.collection));
        let affinity = 0.5;
        let reason = "values match a unique key";
        if (normalizeName(leaf) === normalizeName(key.path) && key.collection !== name) {
          affinity = 1;
          reason = `same field name as the key "${key.collection}.${key.path}"`;
        } else if (fieldStem && (fieldStem === collStem || fieldStem === keyStem || collStem.endsWith(fieldStem) || fieldStem.endsWith(collStem))) {
          affinity = 0.9;
          reason = `field name "${leaf}" refers to "${key.collection}"`;
        } else if (key.collection === name && keyStem && fieldStem !== keyStem) {
          // e.g. employees.managerId -> employees.employeeId
          affinity = 0.75;
          reason = `values reference other records in "${name}" (self reference)`;
        }
        // Small integer keys collide easily; require name affinity for them.
        if (key.numeric && affinity < 0.9) continue;
        const confidence = Math.round(coverage * affinity * 100) / 100;
        if (confidence < 0.45) continue;

        const distinct = new Set(values.map(k)).size;
        const type: RelationshipType = distinct === values.length && key.collection !== name && !path.includes("[]") ? "one-to-one" : "many-to-one";
        const candidate: SuggestedRelationship = {
          from: `${name}.${path}`,
          to: `${key.collection}.${key.path}`,
          type: type === "one-to-one" && values.length < 3 ? "many-to-one" : type,
          confidence,
          coverage: Math.round(coverage * 1000) / 1000,
          reason,
        };
        if (values.length < sample.length && !path.includes("[]")) candidate.nullable = Math.round((1 - values.length / sample.length) * 100) / 100;
        if (!best || candidate.confidence > best.confidence) best = candidate;
      }
      if (best) suggestions.push(best);
    }
  }
  return suggestions.sort((a, b) => b.confidence - a.confidence);
}
