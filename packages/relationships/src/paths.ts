/**
 * Field-path helpers. Paths use dots for object keys and "[]" for array
 * elements, e.g. "address.city" or "items[].productId".
 */

export type PathSegment = { key: string; each: boolean };

const SEGMENT = /^([^.[\]]+)(\[\])?$/;
const FORBIDDEN_KEYS = new Set(["__proto__", "prototype", "constructor"]);

export class PathError extends Error {
  constructor(message: string, readonly path: string) {
    super(message);
    this.name = "PathError";
  }
}

export function parsePath(path: string): PathSegment[] {
  if (typeof path !== "string" || path.length === 0) throw new PathError("Field path must be a non-empty string", String(path));
  return path.split(".").map((part) => {
    const m = SEGMENT.exec(part);
    if (!m) throw new PathError(`Invalid field path "${path}" (segment "${part}")`, path);
    const key = m[1] as string;
    if (FORBIDDEN_KEYS.has(key)) throw new PathError(`Forbidden key "${key}" in path "${path}"`, path);
    return { key, each: m[2] === "[]" };
  });
}

export function formatPath(segments: PathSegment[]): string {
  return segments.map((s) => (s.each ? `${s.key}[]` : s.key)).join(".");
}

export interface PathHit {
  /** Concrete location, e.g. "items[2].productId". */
  location: string;
  value: unknown;
  /** Set the value at this location. */
  set(value: unknown): void;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Visit every concrete location matching the path within a record. Missing
 * intermediate objects are skipped (not created).
 */
export function visitPath(record: unknown, path: string | PathSegment[], visit: (hit: PathHit) => void): void {
  const segs = typeof path === "string" ? parsePath(path) : path;
  const walk = (node: unknown, i: number, loc: string) => {
    if (!isObject(node)) return;
    const seg = segs[i] as PathSegment;
    if (!Object.prototype.hasOwnProperty.call(node, seg.key)) return;
    const here = loc ? `${loc}.${seg.key}` : seg.key;
    const value = node[seg.key];
    const last = i === segs.length - 1;
    if (seg.each) {
      if (!Array.isArray(value)) return;
      value.forEach((el, idx) => {
        const elLoc = `${here}[${idx}]`;
        if (last) visit({ location: elLoc, value: el, set: (v) => (value[idx] = v) });
        else walk(el, i + 1, elLoc);
      });
      return;
    }
    if (last) visit({ location: here, value, set: (v) => (node[seg.key] = v) });
    else walk(value, i + 1, here);
  };
  walk(record, 0, "");
}

/** Collect all values at a path (flattening arrays marked with []). */
export function getAll(record: unknown, path: string | PathSegment[]): unknown[] {
  const out: unknown[] = [];
  visitPath(record, path, (h) => out.push(h.value));
  return out;
}

/** Get a single value at a path without array expansion. */
export function getValue(record: unknown, path: string): unknown {
  let node: unknown = record;
  for (const seg of parsePath(path)) {
    if (!isObject(node)) return undefined;
    node = node[seg.key];
  }
  return node;
}

/** Set a value at a simple dotted path, creating intermediate objects. */
export function setValue(record: Record<string, unknown>, path: string, value: unknown): void {
  const segs = parsePath(path);
  let node: Record<string, unknown> = record;
  segs.forEach((seg, i) => {
    if (seg.each) throw new PathError(`setValue does not support array paths ("${path}")`, path);
    if (i === segs.length - 1) node[seg.key] = value;
    else {
      if (!isObject(node[seg.key])) node[seg.key] = {};
      node = node[seg.key] as Record<string, unknown>;
    }
  });
}
