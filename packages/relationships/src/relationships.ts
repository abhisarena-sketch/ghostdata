import type { Rng } from "@workfonic/dataghost-generators";
import { getAll, parsePath, visitPath, type PathSegment } from "./paths.js";

export type RelationshipType = "many-to-one" | "one-to-one" | "one-to-many";
export type SelfReferenceMode = "tree" | "any";

export interface RelationshipEndpoint {
  collection: string;
  field: string;
}

/**
 * A relationship between a referencing field ("from", the foreign key) and a
 * referenced key ("to"). Endpoints are written "collection.field.path" or as
 * {collection, field} objects. Nested and array paths are supported on the
 * "from" side, e.g. "orders.items[].productId".
 */
export interface RelationshipConfig {
  name?: string;
  from: string | RelationshipEndpoint;
  to: string | RelationshipEndpoint;
  /**
   * many-to-one (default): each reference picks any parent.
   * one-to-one: each parent is referenced at most once.
   * one-to-many: every parent receives between minChildren and maxChildren references.
   */
  type?: RelationshipType;
  /** Probability (0..1) that a reference is null, or true for 0.1. */
  nullable?: boolean | number;
  minChildren?: number;
  maxChildren?: number;
  /** For self references: "tree" (acyclic hierarchy, default) or "any". */
  selfReference?: SelfReferenceMode;
  /** Exclude this edge from dependency ordering (allows intentional cycles). */
  deferred?: boolean;
}

export interface NormalizedRelationship {
  id: string;
  from: { collection: string; path: string; segments: PathSegment[] };
  to: { collection: string; path: string; segments: PathSegment[] };
  type: RelationshipType;
  nullRate: number;
  minChildren: number;
  maxChildren: number;
  self: boolean;
  selfReference: SelfReferenceMode;
  deferred: boolean;
}

export class RelationshipConfigError extends Error {
  constructor(message: string, readonly relationship?: string) {
    super(message);
    this.name = "RelationshipConfigError";
  }
}

export class CircularDependencyError extends Error {
  constructor(readonly cycle: string[]) {
    super(
      `Circular dependency between collections: ${cycle.join(" -> ")}. ` +
        `Mark one relationship in the cycle as "deferred": true (and usually "nullable") to break it.`,
    );
    this.name = "CircularDependencyError";
  }
}

export class ReferentialIntegrityError extends Error {
  constructor(message: string, readonly errors: IntegrityIssue[]) {
    super(message);
    this.name = "ReferentialIntegrityError";
  }
}

function parseEndpoint(e: string | RelationshipEndpoint, side: string, rel: string): { collection: string; path: string; segments: PathSegment[] } {
  let collection: string;
  let path: string;
  if (typeof e === "string") {
    const dot = e.indexOf(".");
    if (dot <= 0 || dot === e.length - 1) {
      throw new RelationshipConfigError(`Relationship ${rel}: "${side}" must look like "collection.field" (got "${e}")`, rel);
    }
    collection = e.slice(0, dot);
    path = e.slice(dot + 1);
  } else if (e && typeof e === "object" && typeof e.collection === "string" && typeof e.field === "string") {
    collection = e.collection;
    path = e.field;
  } else {
    throw new RelationshipConfigError(`Relationship ${rel}: "${side}" is missing or invalid`, rel);
  }
  try {
    return { collection, path, segments: parsePath(path) };
  } catch (err) {
    throw new RelationshipConfigError(`Relationship ${rel}: ${(err as Error).message}`, rel);
  }
}

export function normalizeRelationship(config: RelationshipConfig, index = 0): NormalizedRelationship {
  if (!config || typeof config !== "object") throw new RelationshipConfigError(`Relationship #${index + 1} must be an object`);
  const label = config.name ?? `#${index + 1}`;
  const from = parseEndpoint(config.from, "from", label);
  const to = parseEndpoint(config.to, "to", label);
  if (to.segments.some((s) => s.each)) {
    throw new RelationshipConfigError(`Relationship ${label}: the referenced key "${to.path}" cannot be inside an array`, label);
  }
  const type = config.type ?? "many-to-one";
  if (!["many-to-one", "one-to-one", "one-to-many"].includes(type)) {
    throw new RelationshipConfigError(`Relationship ${label}: unknown type "${type}"`, label);
  }
  const nullRate = config.nullable === true ? 0.1 : config.nullable === false || config.nullable === undefined ? 0 : config.nullable;
  if (typeof nullRate !== "number" || nullRate < 0 || nullRate > 1) {
    throw new RelationshipConfigError(`Relationship ${label}: "nullable" must be a boolean or a probability between 0 and 1`, label);
  }
  const minChildren = config.minChildren ?? (type === "one-to-many" ? 1 : 0);
  const maxChildren = config.maxChildren ?? Number.POSITIVE_INFINITY;
  if (!Number.isInteger(minChildren) || minChildren < 0) throw new RelationshipConfigError(`Relationship ${label}: minChildren must be a non-negative integer`, label);
  if (maxChildren !== Number.POSITIVE_INFINITY && (!Number.isInteger(maxChildren) || maxChildren < Math.max(1, minChildren))) {
    throw new RelationshipConfigError(`Relationship ${label}: maxChildren must be an integer >= max(1, minChildren)`, label);
  }
  const self = from.collection === to.collection;
  if (self && from.path === to.path) throw new RelationshipConfigError(`Relationship ${label}: a field cannot reference itself`, label);
  if (self && type === "one-to-one") throw new RelationshipConfigError(`Relationship ${label}: one-to-one self references are not supported`, label);
  const selfReference = config.selfReference ?? "tree";
  if (!["tree", "any"].includes(selfReference)) throw new RelationshipConfigError(`Relationship ${label}: selfReference must be "tree" or "any"`, label);
  return {
    id: config.name ?? `${from.collection}.${from.path} -> ${to.collection}.${to.path}`,
    from,
    to,
    type,
    nullRate,
    minChildren,
    maxChildren,
    self,
    selfReference,
    deferred: config.deferred === true,
  };
}

export function normalizeRelationships(configs: readonly RelationshipConfig[] = []): NormalizedRelationship[] {
  if (!Array.isArray(configs)) throw new RelationshipConfigError(`"relationships" must be an array`);
  const out = configs.map((c, i) => normalizeRelationship(c, i));
  const seen = new Set<string>();
  for (const r of out) {
    const key = `${r.from.collection}.${r.from.path}`;
    if (seen.has(key)) throw new RelationshipConfigError(`Field "${key}" is the source of more than one relationship`, r.id);
    seen.add(key);
  }
  return out;
}

/**
 * Order collections so that referenced collections are generated before the
 * collections that reference them. Self references and deferred edges are
 * ignored for ordering. Throws CircularDependencyError on cycles.
 */
export function dependencyOrder(collections: readonly string[], relationships: readonly NormalizedRelationship[]): string[] {
  const known = new Set(collections);
  const deps = new Map<string, Set<string>>();
  for (const c of collections) deps.set(c, new Set());
  for (const r of relationships) {
    for (const c of [r.from.collection, r.to.collection]) {
      if (!known.has(c)) throw new RelationshipConfigError(`Relationship ${r.id} refers to unknown collection "${c}"`, r.id);
    }
    if (r.self || r.deferred) continue;
    deps.get(r.from.collection)!.add(r.to.collection);
  }

  const order: string[] = [];
  const state = new Map<string, "visiting" | "done">();
  const stack: string[] = [];
  const visit = (c: string) => {
    const s = state.get(c);
    if (s === "done") return;
    if (s === "visiting") {
      const start = stack.indexOf(c);
      throw new CircularDependencyError([...stack.slice(start), c]);
    }
    state.set(c, "visiting");
    stack.push(c);
    for (const d of Array.from(deps.get(c)!).sort()) visit(d);
    stack.pop();
    state.set(c, "done");
    order.push(c);
  };
  for (const c of collections) visit(c);
  return order;
}

type Rec = Record<string, unknown>;

function keyString(v: unknown): string {
  return typeof v === "string" ? `s:${v}` : `${typeof v}:${JSON.stringify(v)}`;
}

/** Collect the referenced keys of a parent collection, rejecting duplicates and nulls. */
export function collectKeys(records: readonly Rec[], rel: NormalizedRelationship): unknown[] {
  const keys: unknown[] = [];
  const seen = new Set<string>();
  records.forEach((r, i) => {
    const values = getAll(r, rel.to.segments);
    if (values.length === 0 || values[0] === null || values[0] === undefined) {
      throw new RelationshipConfigError(
        `Relationship ${rel.id}: record ${i} of "${rel.to.collection}" has no value for key "${rel.to.path}"`,
        rel.id,
      );
    }
    const k = keyString(values[0]);
    if (seen.has(k)) {
      throw new RelationshipConfigError(
        `Relationship ${rel.id}: key "${rel.to.collection}.${rel.to.path}" is not unique (duplicate at record ${i}). Use a unique generator such as sequence, employeeId or uuid.`,
        rel.id,
      );
    }
    seen.add(k);
    keys.push(values[0]);
  });
  return keys;
}

/**
 * Assign foreign-key values in child records (mutating them) so that every
 * non-null reference points at an existing parent key. Null/absent values are
 * preserved, which keeps schema-level nullability intact.
 */
export function assignForeignKeys(
  children: Rec[],
  parents: readonly Rec[],
  rel: NormalizedRelationship,
  rng: Rng,
): void {
  const keys = collectKeys(parents, rel);
  if (rel.self) return assignSelf(children, keys, rel, rng);

  const slots: ((v: unknown) => void)[] = [];
  for (const child of children) {
    visitPath(child, rel.from.segments, (hit) => {
      if (hit.value === null || hit.value === undefined) return;
      if (rel.nullRate > 0 && rng.bool(rel.nullRate)) {
        hit.set(null);
        return;
      }
      slots.push(hit.set);
    });
  }
  if (slots.length === 0) return;
  if (keys.length === 0) {
    throw new RelationshipConfigError(
      `Relationship ${rel.id}: "${rel.to.collection}" has no records, so ${slots.length} reference(s) cannot be satisfied. Increase its count or make the reference nullable.`,
      rel.id,
    );
  }

  let values: unknown[];
  if (rel.type === "one-to-one") {
    if (slots.length > keys.length) {
      throw new RelationshipConfigError(
        `Relationship ${rel.id}: one-to-one needs at least ${slots.length} "${rel.to.collection}" records but only ${keys.length} exist.`,
        rel.id,
      );
    }
    values = rng.shuffle(keys).slice(0, slots.length);
  } else if (rel.type === "one-to-many" || rel.minChildren > 0 || Number.isFinite(rel.maxChildren)) {
    const min = rel.minChildren;
    const max = rel.maxChildren;
    if (keys.length * min > slots.length) {
      throw new RelationshipConfigError(
        `Relationship ${rel.id}: ${keys.length} parents x minChildren ${min} needs ${keys.length * min} references but only ${slots.length} exist. Increase the "${rel.from.collection}" count or lower minChildren.`,
        rel.id,
      );
    }
    if (Number.isFinite(max) && keys.length * max < slots.length) {
      throw new RelationshipConfigError(
        `Relationship ${rel.id}: ${slots.length} references exceed ${keys.length} parents x maxChildren ${max}. Increase the "${rel.to.collection}" count or raise maxChildren.`,
        rel.id,
      );
    }
    values = [];
    const counts = new Array<number>(keys.length).fill(0);
    for (let k = 0; k < keys.length; k++) for (let j = 0; j < min; j++) {
      values.push(keys[k]);
      counts[k]!++;
    }
    const open = keys.map((_, i) => i).filter((i) => counts[i]! < max);
    while (values.length < slots.length) {
      const pos = rng.int(0, open.length - 1);
      const k = open[pos] as number;
      values.push(keys[k]);
      counts[k]!++;
      if (counts[k]! >= max) open.splice(pos, 1);
    }
    values = rng.shuffle(values);
  } else {
    values = slots.map(() => rng.pick(keys));
  }
  slots.forEach((set, i) => set(values[i]));
}

function assignSelf(records: Rec[], keys: unknown[], rel: NormalizedRelationship, rng: Rng): void {
  const counts = new Map<number, number>();
  const max = rel.maxChildren;
  records.forEach((record, i) => {
    visitPath(record, rel.from.segments, (hit) => {
      if (hit.value === null || hit.value === undefined) return;
      if (rel.nullRate > 0 && rng.bool(rel.nullRate)) return hit.set(null);
      // Candidate parents: earlier records (tree) or any other record.
      const limit = rel.selfReference === "tree" ? i : records.length;
      if (limit === 0 || (rel.selfReference === "any" && records.length < 2)) return hit.set(null);
      for (let attempt = 0; attempt < 32; attempt++) {
        let j = rng.int(0, limit - 1);
        if (rel.selfReference === "any" && j === i) j = (j + 1) % records.length;
        if ((counts.get(j) ?? 0) < max) {
          counts.set(j, (counts.get(j) ?? 0) + 1);
          return hit.set(keys[j]);
        }
      }
      hit.set(null);
    });
  });
}

// ---------------------------------------------------------------------------
// Integrity validation
// ---------------------------------------------------------------------------

export type IntegrityIssueKind = "dangling-reference" | "duplicate-key" | "missing-key" | "one-to-one-violation" | "cardinality" | "cycle" | "unknown-collection";

export interface IntegrityIssue {
  relationship: string;
  kind: IntegrityIssueKind;
  collection: string;
  recordIndex?: number;
  location?: string;
  message: string;
}

export interface RelationshipStats {
  relationship: string;
  references: number;
  nullReferences: number;
  danglingReferences: number;
  parents: number;
  referencedParents: number;
}

export interface IntegrityReport {
  valid: boolean;
  issues: IntegrityIssue[];
  stats: RelationshipStats[];
  /** True when more issues existed than were recorded. */
  truncated: boolean;
}

const MAX_ISSUES_PER_RELATIONSHIP = 50;

function isNormalized(c: RelationshipConfig | NormalizedRelationship): c is NormalizedRelationship {
  const from = (c as NormalizedRelationship).from;
  return typeof from === "object" && from !== null && Array.isArray(from.segments);
}

/** Validate referential integrity of a dataset against relationship definitions. */
export function validateIntegrity(dataset: Record<string, readonly Rec[]>, configs: readonly (RelationshipConfig | NormalizedRelationship)[]): IntegrityReport {
  const rels = configs.map((c, i) => (isNormalized(c) ? c : normalizeRelationship(c, i)));
  const issues: IntegrityIssue[] = [];
  const stats: RelationshipStats[] = [];
  let truncated = false;

  for (const rel of rels) {
    const local: IntegrityIssue[] = [];
    const push = (i: IntegrityIssue) => {
      if (local.length < MAX_ISSUES_PER_RELATIONSHIP) local.push(i);
      else truncated = true;
    };
    const parents = dataset[rel.to.collection];
    const children = dataset[rel.from.collection];
    if (!parents || !children) {
      const missing = !parents ? rel.to.collection : rel.from.collection;
      issues.push({ relationship: rel.id, kind: "unknown-collection", collection: missing, message: `Collection "${missing}" is not in the dataset` });
      continue;
    }

    const keyIndex = new Map<string, number>();
    parents.forEach((p, i) => {
      const v = getAll(p, rel.to.segments)[0];
      if (v === null || v === undefined) {
        push({ relationship: rel.id, kind: "missing-key", collection: rel.to.collection, recordIndex: i, location: rel.to.path, message: `Parent record ${i} has no key "${rel.to.path}"` });
        return;
      }
      const k = keyString(v);
      if (keyIndex.has(k)) {
        push({ relationship: rel.id, kind: "duplicate-key", collection: rel.to.collection, recordIndex: i, location: rel.to.path, message: `Duplicate key ${JSON.stringify(v)} in "${rel.to.collection}.${rel.to.path}"` });
        return;
      }
      keyIndex.set(k, i);
    });

    let references = 0;
    let nulls = 0;
    let dangling = 0;
    const childCounts = new Map<string, number>();
    const parentOf = new Map<number, number>();
    children.forEach((c, ci) => {
      visitPath(c, rel.from.segments, (hit) => {
        if (hit.value === null || hit.value === undefined) {
          nulls++;
          return;
        }
        references++;
        const k = keyString(hit.value);
        const pi = keyIndex.get(k);
        if (pi === undefined) {
          dangling++;
          push({
            relationship: rel.id,
            kind: "dangling-reference",
            collection: rel.from.collection,
            recordIndex: ci,
            location: hit.location,
            message: `Record ${ci} of "${rel.from.collection}" references ${JSON.stringify(hit.value)} at "${hit.location}", which does not exist in "${rel.to.collection}.${rel.to.path}"`,
          });
          return;
        }
        childCounts.set(k, (childCounts.get(k) ?? 0) + 1);
        if (rel.self) parentOf.set(ci, pi);
      });
    });

    if (rel.type === "one-to-one") {
      for (const [k, n] of childCounts) if (n > 1) push({ relationship: rel.id, kind: "one-to-one-violation", collection: rel.from.collection, message: `Parent ${k.slice(2)} is referenced ${n} times in a one-to-one relationship` });
    }
    if (rel.minChildren > 0 || Number.isFinite(rel.maxChildren)) {
      for (const [k, pi] of keyIndex) {
        const n = childCounts.get(k) ?? 0;
        if (n < rel.minChildren || n > rel.maxChildren) {
          push({ relationship: rel.id, kind: "cardinality", collection: rel.to.collection, recordIndex: pi, message: `Parent record ${pi} has ${n} children (expected ${rel.minChildren}..${Number.isFinite(rel.maxChildren) ? rel.maxChildren : "any"})` });
        }
      }
    }
    if (rel.self && rel.selfReference === "tree") {
      // Detect cycles by following parent pointers.
      const color = new Map<number, number>();
      for (const start of parentOf.keys()) {
        if (color.get(start) === 2) continue;
        const path: number[] = [];
        let cur: number | undefined = start;
        while (cur !== undefined && color.get(cur) !== 2) {
          if (color.get(cur) === 1) {
            push({ relationship: rel.id, kind: "cycle", collection: rel.from.collection, recordIndex: cur, message: `Self reference cycle through record ${cur} in "${rel.from.collection}"` });
            break;
          }
          color.set(cur, 1);
          path.push(cur);
          cur = parentOf.get(cur);
        }
        for (const p of path) color.set(p, 2);
      }
    }

    stats.push({ relationship: rel.id, references, nullReferences: nulls, danglingReferences: dangling, parents: keyIndex.size, referencedParents: childCounts.size });
    issues.push(...local);
  }
  return { valid: issues.length === 0, issues, stats, truncated };
}

/** Throw ReferentialIntegrityError if the dataset violates any relationship. */
export function assertIntegrity(dataset: Record<string, readonly Rec[]>, rels: readonly (RelationshipConfig | NormalizedRelationship)[]): IntegrityReport {
  const report = validateIntegrity(dataset, rels);
  if (!report.valid) {
    const first = report.issues.slice(0, 3).map((i) => i.message).join("; ");
    throw new ReferentialIntegrityError(`Referential integrity check failed with ${report.issues.length} issue(s): ${first}`, report.issues);
  }
  return report;
}
