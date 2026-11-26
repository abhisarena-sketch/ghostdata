/**
 * Seeded pseudo-random number generation.
 *
 * DataGhost uses a small, fast, non-cryptographic PRNG (sfc32) seeded through
 * the cyrb128 string hash. It is deterministic across platforms because it
 * only uses 32-bit integer arithmetic. It is NOT suitable for security
 * purposes and must never be used to create secrets.
 */

export type Seed = number | string;

/** Hash an arbitrary string into four 32-bit integers (cyrb128). */
export function hash128(input: string): [number, number, number, number] {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < input.length; i++) {
    const k = input.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

/** Hash a string to a single unsigned 32-bit integer. */
export function hash32(input: string): number {
  return hash128(input)[0];
}

/** Hash a string to a lowercase hex string of the requested length (max 32). */
export function hashHex(input: string, length = 16): string {
  const parts = hash128(input);
  const hex = parts.map((p) => p.toString(16).padStart(8, "0")).join("");
  return hex.slice(0, Math.min(length, 32));
}

export interface Rng {
  /** The seed label this RNG was derived from (for diagnostics only). */
  readonly label: string;
  /** Float in [0, 1). */
  next(): number;
  /** Integer in [min, max] (inclusive). */
  int(min: number, max: number): number;
  /** Float in [min, max). */
  float(min: number, max: number): number;
  /** True with probability p. */
  bool(p?: number): boolean;
  /** Pick one element. Throws on empty arrays. */
  pick<T>(items: readonly T[]): T;
  /** Pick using relative weights. */
  weighted<T>(items: readonly T[], weights: readonly number[]): T;
  /** Standard normal sample scaled to mean/stddev. */
  normal(mean?: number, stddev?: number): number;
  /** Exponential sample with rate lambda. */
  exponential(lambda?: number): number;
  /** Shuffle a copy of the array (Fisher-Yates). */
  shuffle<T>(items: readonly T[]): T[];
  /** Random string from an alphabet. */
  string(length: number, alphabet: string): string;
  /** Hex string of the given length. */
  hex(length: number): string;
  /** Derive an independent child RNG. Deterministic for the same label. */
  fork(label: string): Rng;
}

class Sfc32 implements Rng {
  private a: number;
  private b: number;
  private c: number;
  private d: number;
  private spare: number | null = null;

  constructor(
    readonly label: string,
    seedState: [number, number, number, number],
  ) {
    [this.a, this.b, this.c, this.d] = seedState;
    // Warm up so that similar seeds diverge quickly.
    for (let i = 0; i < 12; i++) this.nextUint32();
  }

  private nextUint32(): number {
    this.a >>>= 0;
    this.b >>>= 0;
    this.c >>>= 0;
    this.d >>>= 0;
    let t = (this.a + this.b) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.d = (this.d + 1) | 0;
    t = (t + this.d) | 0;
    this.c = (this.c + t) | 0;
    return t >>> 0;
  }

  next(): number {
    return this.nextUint32() / 4294967296;
  }

  int(min: number, max: number): number {
    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      throw new RangeError(`int() bounds must be finite (got ${min}, ${max})`);
    }
    const lo = Math.ceil(Math.min(min, max));
    const hi = Math.floor(Math.max(min, max));
    if (hi < lo) return lo;
    return lo + Math.floor(this.next() * (hi - lo + 1));
  }

  float(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  bool(p = 0.5): boolean {
    return this.next() < p;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new RangeError("pick() called with an empty list");
    return items[Math.floor(this.next() * items.length)] as T;
  }

  weighted<T>(items: readonly T[], weights: readonly number[]): T {
    if (items.length === 0) throw new RangeError("weighted() called with an empty list");
    if (weights.length !== items.length) {
      throw new RangeError("weighted() requires one weight per item");
    }
    let total = 0;
    for (const w of weights) total += Math.max(0, w);
    if (total <= 0) return this.pick(items);
    let r = this.next() * total;
    for (let i = 0; i < items.length; i++) {
      r -= Math.max(0, weights[i] as number);
      if (r < 0) return items[i] as T;
    }
    return items[items.length - 1] as T;
  }

  normal(mean = 0, stddev = 1): number {
    if (this.spare !== null) {
      const s = this.spare;
      this.spare = null;
      return mean + s * stddev;
    }
    let u = 0;
    let v = 0;
    let s = 0;
    do {
      u = this.next() * 2 - 1;
      v = this.next() * 2 - 1;
      s = u * u + v * v;
    } while (s >= 1 || s === 0);
    const mul = Math.sqrt((-2 * Math.log(s)) / s);
    this.spare = v * mul;
    return mean + u * mul * stddev;
  }

  exponential(lambda = 1): number {
    return -Math.log(1 - this.next()) / lambda;
  }

  shuffle<T>(items: readonly T[]): T[] {
    const out = items.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      const tmp = out[i] as T;
      out[i] = out[j] as T;
      out[j] = tmp;
    }
    return out;
  }

  string(length: number, alphabet: string): string {
    let s = "";
    for (let i = 0; i < length; i++) s += alphabet[Math.floor(this.next() * alphabet.length)];
    return s;
  }

  hex(length: number): string {
    return this.string(length, "0123456789abcdef");
  }

  fork(label: string): Rng {
    return createRng(`${this.label}/${label}`);
  }
}

/** Normalise a seed into a stable string label. */
export function seedLabel(seed: Seed): string {
  return typeof seed === "number" ? `n:${seed}` : `s:${seed}`;
}

/** Create a deterministic RNG from a seed (number or string). */
export function createRng(seed: Seed): Rng {
  const label = typeof seed === "number" ? seedLabel(seed) : seed;
  return new Sfc32(label, hash128(label));
}

/** Create a random (non-deterministic) seed for runs where none was configured. */
export function randomSeed(): number {
  // Math.random is acceptable here: the seed only drives synthetic values.
  return Math.floor(Math.random() * 2 ** 31);
}
