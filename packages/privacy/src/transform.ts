import { createRng, defaultRegistry, luhnCheckDigit, vocab, type Rng } from "@workfonic/dataghost-generators";
import type { SensitiveCategory } from "./detect.js";

/**
 * Transformations applied to individual values.
 *
 * - keep: leave the value unchanged (only for non-sensitive data, or when explicitly configured)
 * - redact: replace with "[REDACTED]" (always used for passwords, tokens and keys)
 * - pseudonymize: consistent replacement; the same input maps to the same output within a run
 * - format-preserve: replace letters/digits while keeping length, case and punctuation
 * - synthesize: replace with a newly generated realistic value of the same kind
 * - generalize: reduce precision (dates to year, numbers to buckets, postal codes to prefix)
 * - null: replace with null
 */
export type Transformation = "keep" | "redact" | "pseudonymize" | "format-preserve" | "synthesize" | "generalize" | "null";

export const TRANSFORMATIONS: readonly Transformation[] = ["keep", "redact", "pseudonymize", "format-preserve", "synthesize", "generalize", "null"];

export const REDACTED = "[REDACTED]";

/** Default transformation per detected category when masking. */
export const DEFAULT_TRANSFORMATIONS: Readonly<Record<SensitiveCategory, Transformation>> = {
  email: "pseudonymize",
  phone: "pseudonymize",
  governmentId: "format-preserve",
  cardNumber: "format-preserve",
  password: "redact",
  authToken: "redact",
  apiKey: "redact",
  ipAddress: "pseudonymize",
  personName: "pseudonymize",
  address: "synthesize",
  dateOfBirth: "generalize",
  identifier: "pseudonymize",
  quasiIdentifier: "keep",
  freeText: "synthesize",
};

/** Categories whose source values must never be copied, whatever the configuration says. */
export const NEVER_KEEP: ReadonlySet<SensitiveCategory> = new Set(["password", "authToken", "apiKey"]);

export function defaultTransformation(category: SensitiveCategory | undefined): Transformation {
  return category ? DEFAULT_TRANSFORMATIONS[category] : "keep";
}

/** Generate a random secret for pseudonymisation when no seed is configured. */
export function randomSecret(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Keeps replacements consistent: the same (namespace, value) pair always maps
 * to the same output within a run, so identifiers shared across fields and
 * collections still match after masking. Outputs are checked for collisions.
 *
 * The mapping is derived with a non-cryptographic hash keyed by `secret`.
 * Anyone who knows the secret (or the seed it was derived from) and can guess
 * candidate inputs could test them, so treat seeded masking output as
 * pseudonymised, not anonymised.
 */
export class Pseudonymizer {
  private readonly forward = new Map<string, unknown>();
  private readonly reverse = new Map<string, string>();

  constructor(private readonly secret: string = randomSecret()) {}

  get size(): number {
    return this.forward.size;
  }

  /** Deterministic RNG for a given input value. */
  rngFor(namespace: string, value: unknown, attempt = 0): Rng {
    return createRng(`${this.secret}|${namespace}|${typeof value}:${JSON.stringify(value)}|${attempt}`);
  }

  /**
   * Map a value. With `unique`, distinct inputs are guaranteed distinct
   * outputs (needed for identifiers and keys); otherwise collisions are allowed.
   */
  map<T>(namespace: string, value: unknown, options: { unique: boolean }, produce: (rng: Rng) => T): T {
    const key = `${namespace}|${typeof value}:${JSON.stringify(value)}`;
    if (this.forward.has(key)) return this.forward.get(key) as T;
    if (!options.unique) {
      const out = produce(this.rngFor(namespace, value, 0));
      this.forward.set(key, out);
      return out;
    }
    for (let attempt = 0; attempt < 64; attempt++) {
      const out = produce(this.rngFor(namespace, value, attempt));
      const outKey = `${namespace}|${typeof out}:${JSON.stringify(out)}`;
      const owner = this.reverse.get(outKey);
      if (owner === undefined || owner === key) {
        this.forward.set(key, out);
        this.reverse.set(outKey, key);
        return out;
      }
    }
    throw new Error(`Could not find a collision-free replacement in namespace "${namespace}". The value space is too small.`);
  }
}

const UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const LOWER = "abcdefghijklmnopqrstuvwxyz";

/** Replace digits and letters, keeping length, case and punctuation. */
export function formatPreserve(value: string, rng: Rng, options: { keepPrefix?: boolean } = {}): string {
  let start = 0;
  if (options.keepPrefix) {
    const m = /^[A-Z]{1,6}[-_]/.exec(value);
    if (m) start = m[0].length;
  }
  let out = value.slice(0, start);
  for (let i = start; i < value.length; i++) {
    const c = value[i] as string;
    if (c >= "0" && c <= "9") out += String(rng.int(0, 9));
    else if (c >= "A" && c <= "Z") out += UPPER[rng.int(0, 25)];
    else if (c >= "a" && c <= "z") out += LOWER[rng.int(0, 25)];
    else out += c;
  }
  return out;
}

function fill(template: string, digits: string): string {
  let i = 0;
  return template.replace(/\d/g, () => digits[i++] ?? "0");
}

function maskPhone(value: string, rng: Rng): string {
  const count = (value.match(/\d/g) ?? []).length;
  // Fictional NANP 555-01xx ending; leading digits random.
  const tail = `55501${rng.int(0, 9)}${rng.int(0, 9)}`;
  let digits = "";
  for (let i = 0; i < Math.max(0, count - tail.length); i++) digits += String(rng.int(0, 9));
  digits = (digits + tail).slice(-count);
  return fill(value, digits);
}

function maskCard(value: string, rng: Rng): string {
  const digits = value.replace(/\D/g, "");
  const body = ("0000" + Array.from({ length: Math.max(0, digits.length - 5) }, () => rng.int(0, 9)).join("")).slice(0, Math.max(1, digits.length - 1));
  const check = (luhnCheckDigit(body) + 1 + rng.int(0, 8)) % 10;
  return fill(value, body + check);
}

function maskGovernmentId(value: string, rng: Rng): string {
  if (/^\d{3}-\d{2}-\d{4}$/.test(value)) return `000-${String(rng.int(1, 99)).padStart(2, "0")}-${String(rng.int(1, 9999)).padStart(4, "0")}`;
  return formatPreserve(value, rng);
}

function maskIp(value: string, rng: Rng): string {
  if (value.includes(":")) return `2001:db8::${rng.hex(4)}:${rng.hex(4)}`;
  return `${rng.pick(["192.0.2", "198.51.100", "203.0.113"])}.${rng.int(1, 254)}`;
}

function maskEmail(rng: Rng): string {
  const first = rng.pick(vocab.FIRST_NAMES).toLowerCase();
  const last = rng.pick(vocab.LAST_NAMES).toLowerCase();
  return `${first}.${last}.${rng.hex(4)}@example.com`;
}

function maskName(value: string, rng: Rng): string {
  const words = value.trim().split(/\s+/).length;
  const first = rng.pick(vocab.FIRST_NAMES);
  const last = rng.pick(vocab.LAST_NAMES);
  if (words <= 1) return rng.bool() ? first : last;
  return `${first} ${last}`;
}

function generalizeDate(value: string): string {
  const m = /^(\d{4})/.exec(value);
  if (!m) return REDACTED;
  if (/^\d{4}-\d{2}-\d{2}T/.test(value)) return `${m[1]}-01-01T00:00:00.000Z`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return `${m[1]}-01-01`;
  return m[1] as string;
}

function generalizeValue(value: unknown, category?: SensitiveCategory): unknown {
  if (typeof value === "number") {
    const bucket = Math.abs(value) >= 1000 ? 1000 : 10;
    return Math.floor(value / bucket) * bucket;
  }
  if (typeof value !== "string") return null;
  if (category === "dateOfBirth" || /^\d{4}-\d{2}-\d{2}/.test(value)) return generalizeDate(value);
  if (category === "quasiIdentifier" || category === "address") return value.length > 2 ? value.slice(0, Math.ceil(value.length / 2)) + "*".repeat(Math.floor(value.length / 2)) : "**";
  return REDACTED;
}

const synthesizers: Partial<Record<SensitiveCategory, string>> = {
  email: "email",
  phone: "phone",
  personName: "fullName",
  address: "address",
  dateOfBirth: "dateOfBirth",
  ipAddress: "ipv4",
  governmentId: "governmentId",
  cardNumber: "cardNumber",
  freeText: "sentence",
};

function synthesize(value: unknown, category: SensitiveCategory | undefined, rng: Rng, referenceDate: Date): unknown {
  const name = category ? synthesizers[category] : undefined;
  if (name) {
    const def = defaultRegistry.get(name)!;
    const opts = defaultRegistry.parseOptions(name, {}, "mask");
    const out = def.generate({ rng, index: 0, siblings: {}, referenceDate, path: "mask" }, opts);
    if (category === "freeText" && typeof value === "string" && typeof out === "string") {
      // Similar length to the original, made of neutral words.
      let s = out;
      while (s.length < value.length) s += " " + rng.pick(vocab.WORDS);
      return s.slice(0, Math.max(1, value.length));
    }
    return out;
  }
  if (typeof value === "string") return formatPreserve(value, rng);
  if (typeof value === "number") return Number.isInteger(value) ? rng.int(0, Math.max(10, Math.abs(value) * 2)) : Math.round(rng.next() * Math.abs(value) * 200) / 100;
  if (typeof value === "boolean") return rng.bool();
  return null;
}

export interface TransformContext {
  pseudonymizer: Pseudonymizer;
  /** RNG for non-consistent transformations. */
  rng: Rng;
  referenceDate: Date;
  category?: SensitiveCategory;
}

/**
 * Apply a transformation to a single value. Objects and arrays are not
 * walked here; callers transform leaf values. Secrets are never kept.
 */
export function transformValue(value: unknown, transformation: Transformation, ctx: TransformContext): unknown {
  if (value === null || value === undefined) return value;
  const category = ctx.category;
  let t = transformation;
  if (category && NEVER_KEEP.has(category) && (t === "keep" || t === "generalize")) t = "redact";
  if (typeof value === "object") {
    if (t === "keep") return value;
    if (t === "null") return null;
    return t === "redact" ? REDACTED : null;
  }
  switch (t) {
    case "keep":
      return value;
    case "null":
      return null;
    case "redact":
      return typeof value === "string" ? REDACTED : null;
    case "generalize":
      return generalizeValue(value, category);
    case "format-preserve":
      if (typeof value !== "string") return synthesize(value, category, ctx.rng, ctx.referenceDate);
      if (category === "cardNumber") return maskCard(value, ctx.rng);
      if (category === "governmentId") return maskGovernmentId(value, ctx.rng);
      if (category === "phone") return maskPhone(value, ctx.rng);
      return formatPreserve(value, ctx.rng, { keepPrefix: category === "identifier" });
    case "synthesize":
      return synthesize(value, category, ctx.rng, ctx.referenceDate);
    case "pseudonymize": {
      const ns = category === "identifier" || !category ? "id" : category;
      return ctx.pseudonymizer.map(ns, value, { unique: ns === "id" || ns === "email" }, (rng) => {
        if (typeof value === "number") return Number.isInteger(value) ? rng.int(1, Math.max(1_000_000, Math.abs(value) * 10)) : Math.round(rng.next() * 1e6) / 100;
        if (typeof value !== "string") return synthesize(value, category, rng, ctx.referenceDate);
        switch (category) {
          case "email":
            return maskEmail(rng);
          case "phone":
            return maskPhone(value, rng);
          case "personName":
            return maskName(value, rng);
          case "ipAddress":
            return maskIp(value, rng);
          case "cardNumber":
            return maskCard(value, rng);
          case "governmentId":
            return maskGovernmentId(value, rng);
          default:
            return formatPreserve(value, rng, { keepPrefix: true });
        }
      });
    }
  }
}
