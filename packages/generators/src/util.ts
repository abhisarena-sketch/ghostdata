import type { Rng } from "./rng.js";

const DAY_MS = 86_400_000;

/**
 * Resolve a date option. Accepts ISO strings ("2024-01-31", full timestamps)
 * or offsets relative to the reference date: "-5y", "+18m", "-30d", "now".
 */
export function resolveDate(value: string | number | Date | undefined, reference: Date, fallback: Date): Date {
  if (value === undefined) return fallback;
  if (value instanceof Date) return value;
  if (typeof value === "number") return new Date(value);
  const trimmed = value.trim();
  if (trimmed === "now") return new Date(reference.getTime());
  const rel = /^([+-]?\d+)\s*([dwmy])$/i.exec(trimmed);
  if (rel) {
    const amount = Number(rel[1]);
    const unit = (rel[2] as string).toLowerCase();
    const d = new Date(reference.getTime());
    if (unit === "d") d.setUTCDate(d.getUTCDate() + amount);
    else if (unit === "w") d.setUTCDate(d.getUTCDate() + amount * 7);
    else if (unit === "m") d.setUTCMonth(d.getUTCMonth() + amount);
    else d.setUTCFullYear(d.getUTCFullYear() + amount);
    return d;
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) throw new RangeError(`Invalid date value "${value}"`);
  return parsed;
}

export function isValidDateInput(value: unknown): boolean {
  if (typeof value !== "string") return typeof value === "number";
  if (value === "now" || /^([+-]?\d+)\s*([dwmy])$/i.test(value.trim())) return true;
  return !Number.isNaN(new Date(value).getTime());
}

export function randomDateBetween(rng: Rng, from: Date, to: Date): Date {
  const a = from.getTime();
  const b = to.getTime();
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  return new Date(lo + Math.floor(rng.next() * (hi - lo + 1)));
}

export function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * DAY_MS);
}

export function pad(n: number | string, width: number): string {
  return String(n).padStart(width, "0");
}

export function slugify(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "");
}

export function roundTo(value: number, precision: number): number {
  const f = 10 ** precision;
  return Math.round(value * f) / f;
}

export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

export type Distribution = "uniform" | "normal" | "exponential";

export interface NumericOptions {
  min: number;
  max: number;
  distribution?: Distribution;
  mean?: number;
  stddev?: number;
  lambda?: number;
}

/** Sample a number in [min, max] following the configured distribution. */
export function sampleNumber(rng: Rng, o: NumericOptions): number {
  const { min, max } = o;
  if (max < min) throw new RangeError(`max (${max}) must be >= min (${min})`);
  switch (o.distribution ?? "uniform") {
    case "normal": {
      const mean = o.mean ?? (min + max) / 2;
      const sd = o.stddev ?? (max - min) / 6;
      // Rejection sampling keeps the shape inside the bounds; fall back to clamping.
      for (let i = 0; i < 16; i++) {
        const v = rng.normal(mean, sd);
        if (v >= min && v <= max) return v;
      }
      return clamp(rng.normal(mean, sd), min, max);
    }
    case "exponential": {
      const lambda = o.lambda ?? 3 / Math.max(max - min, Number.EPSILON);
      for (let i = 0; i < 16; i++) {
        const v = min + rng.exponential(lambda);
        if (v <= max) return v;
      }
      return min + rng.next() * (max - min);
    }
    default:
      return rng.float(min, max);
  }
}
