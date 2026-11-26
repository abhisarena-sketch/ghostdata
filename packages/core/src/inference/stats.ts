/**
 * Incremental statistics collected while scanning records. Memory is bounded:
 * at most SAMPLE_SIZE sampled values and DISTINCT_CAP distinct values are kept
 * per field, so very large inputs can be inspected in a streaming fashion.
 */

export const SAMPLE_SIZE = 200;
export const DISTINCT_CAP = 1000;

export type StringFormat = "date" | "timestamp" | "uuid" | "objectId" | "email" | "url" | "ipv4" | "ipv6" | "phone" | "numeric" | "idPattern";

const FORMATS: [StringFormat, RegExp][] = [
  ["date", /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/],
  ["timestamp", /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:?\d{2})?$/],
  ["uuid", /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i],
  ["objectId", /^[0-9a-f]{24}$/i],
  ["email", /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/],
  ["url", /^https?:\/\/[^\s/$.?#].[^\s]*$/i],
  ["ipv4", /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/],
  ["ipv6", /^(?=.*:.*:)[0-9a-f:]{2,39}$/i],
  ["phone", /^\+?(?=(?:[^\d]*\d){7,15}[^\d]*$)[\d\s().-]{7,22}$/],
  ["numeric", /^-?\d+(\.\d+)?$/],
  ["idPattern", /^[A-Za-z]{1,10}[-_]?\d{1,12}$/],
];

export interface StringStats {
  count: number;
  minLength: number;
  maxLength: number;
  formats: Partial<Record<StringFormat, number>>;
  /** Longest shared alphabetic prefix for id-like strings, and their digit width. */
  idPrefix?: string | null;
  idDigits?: number;
  idMaxNumber?: number;
}

export interface NumberStats {
  count: number;
  integers: number;
  min: number;
  max: number;
  sum: number;
  sumSq: number;
  maxDecimals: number;
}

export interface FieldAccumulator {
  /** How many times the key was present (including null values). */
  present: number;
  nulls: number;
  /** Number of parent objects scanned (to compute optionality). */
  parents: number;
  types: Record<"string" | "integer" | "number" | "boolean" | "object" | "array" | "extended", number>;
  str?: StringStats;
  num?: NumberStats;
  bool?: { count: number; trues: number };
  arr?: { count: number; minLength: number; maxLength: number; totalLength: number; items: FieldAccumulator };
  obj?: { count: number; children: Map<string, FieldAccumulator>; order: string[] };
  /** MongoDB extended JSON wrappers seen ("$oid", "$date", ...). */
  extended?: Record<string, number>;
  samples: unknown[];
  sampleSeen: number;
  distinct: Map<string, number>;
  distinctOverflow: boolean;
}

export function newAccumulator(): FieldAccumulator {
  return {
    present: 0,
    nulls: 0,
    parents: 0,
    types: { string: 0, integer: 0, number: 0, boolean: 0, object: 0, array: 0, extended: 0 },
    samples: [],
    sampleSeen: 0,
    distinct: new Map(),
    distinctOverflow: false,
  };
}

const EXTENDED_KEYS = new Set(["$oid", "$date", "$numberLong", "$numberDecimal", "$numberInt", "$numberDouble"]);

function isExtended(v: Record<string, unknown>): string | undefined {
  const keys = Object.keys(v);
  if (keys.length !== 1 || !EXTENDED_KEYS.has(keys[0]!)) return undefined;
  return keys[0];
}

function decimals(n: number): number {
  if (Number.isInteger(n)) return 0;
  const s = String(n);
  const e = s.indexOf("e-");
  if (e >= 0) return Number(s.slice(e + 2));
  const dot = s.indexOf(".");
  return dot >= 0 ? s.length - dot - 1 : 0;
}

/** Deterministic sampling: keep the first SAMPLE_SIZE values, then every k-th. */
function sample(acc: FieldAccumulator, v: unknown) {
  acc.sampleSeen++;
  if (acc.samples.length < SAMPLE_SIZE) acc.samples.push(v);
  else {
    const stride = Math.ceil(acc.sampleSeen / SAMPLE_SIZE);
    if (acc.sampleSeen % stride === 0) acc.samples[(acc.sampleSeen / stride) % SAMPLE_SIZE] = v;
  }
}

function track(acc: FieldAccumulator, key: string) {
  if (acc.distinctOverflow) return;
  const n = acc.distinct.get(key);
  if (n !== undefined) acc.distinct.set(key, n + 1);
  else if (acc.distinct.size < DISTINCT_CAP) acc.distinct.set(key, 1);
  else acc.distinctOverflow = true;
}

const MAX_DEPTH = 32;

export function observe(acc: FieldAccumulator, value: unknown, depth = 0): void {
  acc.present++;
  if (value === null || value === undefined) {
    acc.nulls++;
    return;
  }
  if (depth > MAX_DEPTH) return;
  if (typeof value === "string") {
    acc.types.string++;
    const s = (acc.str ??= { count: 0, minLength: Infinity, maxLength: 0, formats: {} });
    s.count++;
    s.minLength = Math.min(s.minLength, value.length);
    s.maxLength = Math.max(s.maxLength, value.length);
    if (value.length <= 512) {
      for (const [name, re] of FORMATS) if (re.test(value)) s.formats[name] = (s.formats[name] ?? 0) + 1;
      const m = /^([A-Za-z]{1,10}[-_]?)(\d{1,12})$/.exec(value);
      if (m) {
        if (s.idPrefix === undefined) s.idPrefix = m[1];
        else if (s.idPrefix !== m[1]) s.idPrefix = null;
        s.idDigits = Math.max(s.idDigits ?? 0, m[2]!.length);
        s.idMaxNumber = Math.max(s.idMaxNumber ?? 0, Number(m[2]));
      }
    }
    sample(acc, value);
    track(acc, `s:${value.length > 200 ? value.slice(0, 200) : value}`);
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return;
    const isInt = Number.isInteger(value);
    acc.types[isInt ? "integer" : "number"]++;
    const n = (acc.num ??= { count: 0, integers: 0, min: Infinity, max: -Infinity, sum: 0, sumSq: 0, maxDecimals: 0 });
    n.count++;
    if (isInt) n.integers++;
    n.min = Math.min(n.min, value);
    n.max = Math.max(n.max, value);
    n.sum += value;
    n.sumSq += value * value;
    n.maxDecimals = Math.max(n.maxDecimals, Math.min(10, decimals(value)));
    sample(acc, value);
    track(acc, `n:${value}`);
    return;
  }
  if (typeof value === "boolean") {
    acc.types.boolean++;
    const b = (acc.bool ??= { count: 0, trues: 0 });
    b.count++;
    if (value) b.trues++;
    sample(acc, value);
    track(acc, `b:${value}`);
    return;
  }
  if (Array.isArray(value)) {
    acc.types.array++;
    const a = (acc.arr ??= { count: 0, minLength: Infinity, maxLength: 0, totalLength: 0, items: newAccumulator() });
    a.count++;
    a.minLength = Math.min(a.minLength, value.length);
    a.maxLength = Math.max(a.maxLength, value.length);
    a.totalLength += value.length;
    for (const el of value) observe(a.items, el, depth + 1);
    return;
  }
  if (typeof value === "object") {
    const rec = value as Record<string, unknown>;
    const ext = isExtended(rec);
    if (ext) {
      acc.types.extended++;
      acc.extended ??= {};
      acc.extended[ext] = (acc.extended[ext] ?? 0) + 1;
      const inner = rec[ext];
      // Record the wrapped value's stats as a string so formats are detected.
      if (typeof inner === "string") {
        const s = (acc.str ??= { count: 0, minLength: Infinity, maxLength: 0, formats: {} });
        s.count++;
        s.minLength = Math.min(s.minLength, inner.length);
        s.maxLength = Math.max(s.maxLength, inner.length);
        for (const [name, re] of FORMATS) if (re.test(inner)) s.formats[name] = (s.formats[name] ?? 0) + 1;
        sample(acc, inner);
        track(acc, `s:${inner}`);
      }
      return;
    }
    acc.types.object++;
    const o = (acc.obj ??= { count: 0, children: new Map<string, FieldAccumulator>(), order: [] as string[] });
    o.count++;
    for (const child of o.children.values()) child.parents++;
    for (const [k, v] of Object.entries(rec)) {
      if (k === "__proto__") continue;
      let child = o.children.get(k);
      if (!child) {
        child = newAccumulator();
        // Parents before this one did not have the key.
        child.parents = o.count;
        o.children.set(k, child);
        o.order.push(k);
      }
      observe(child, v, depth + 1);
    }
  }
}

/** Root accumulator for a collection: records are observed as objects. */
export class CollectionStats {
  readonly root = newAccumulator();
  records = 0;
  skipped = 0;

  add(record: unknown): void {
    if (record === null || typeof record !== "object" || Array.isArray(record)) {
      this.skipped++;
      return;
    }
    this.records++;
    observe(this.root, record);
  }
}
