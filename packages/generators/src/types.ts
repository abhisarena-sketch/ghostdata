import type { z } from "zod";
import type { Rng } from "./rng.js";

export type GeneratorCategory =
  | "personal"
  | "professional"
  | "technical"
  | "numeric"
  | "temporal"
  | "custom"
  | "text";

export interface GeneratorContext {
  /** Field-scoped deterministic RNG. */
  rng: Rng;
  /** Zero-based index of the record being generated within its collection. */
  index: number;
  /** Values already generated for sibling fields in the same object (in schema order). */
  siblings: Readonly<Record<string, unknown>>;
  /** Reference "now" used by relative temporal generators. Fixed for determinism. */
  referenceDate: Date;
  /** Dot path of the field being generated (for error messages). */
  path: string;
}

export type GeneratorFn<O = Record<string, unknown>> = (ctx: GeneratorContext, options: O) => unknown;

export interface GeneratorDefinition<O = Record<string, unknown>> {
  name: string;
  category: GeneratorCategory;
  description: string;
  /** Zod schema validating the generator's options. Unknown options are rejected. */
  options: z.ZodType<O, unknown>;
  generate: GeneratorFn<O>;
  /** Output type, used for validation and CSV typing. */
  output: "string" | "integer" | "number" | "boolean" | "date" | "timestamp" | "object" | "any";
  /** Example options, used in docs and the playground. */
  example?: Record<string, unknown>;
}

export class GeneratorOptionsError extends Error {
  constructor(
    message: string,
    readonly generator: string,
    readonly path: string,
    readonly issues: string[] = [],
  ) {
    super(message);
    this.name = "GeneratorOptionsError";
  }
}
