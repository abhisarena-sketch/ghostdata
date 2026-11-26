import { z } from "zod";
import { BUILTIN_GENERATORS, GENERATOR_ALIASES } from "./builtins.js";
import { GeneratorOptionsError, type GeneratorDefinition, type GeneratorFn } from "./types.js";

/**
 * Version of the built-in generator algorithms and vocabularies.
 *
 * Deterministic output (same schema + config + seed => same data) is only
 * guaranteed for the same GENERATOR_VERSION. Any change to a vocabulary,
 * algorithm or RNG consumption order bumps this version and is listed in
 * CHANGELOG.md.
 */
export const GENERATOR_VERSION = "1.0.0";

export class GeneratorRegistry {
  private readonly defs = new Map<string, GeneratorDefinition<any>>();
  private readonly aliases = new Map<string, string>();

  constructor(definitions: readonly GeneratorDefinition<any>[] = BUILTIN_GENERATORS, aliases = GENERATOR_ALIASES) {
    for (const d of definitions) this.defs.set(d.name, d);
    for (const [alias, target] of Object.entries(aliases)) this.aliases.set(alias, target);
  }

  /** Resolve a (possibly aliased) generator name to its canonical name, or undefined. */
  resolveName(name: string): string | undefined {
    if (this.defs.has(name)) return name;
    const alias = this.aliases.get(name);
    if (alias && this.defs.has(alias)) return alias;
    const lower = name.toLowerCase();
    for (const key of this.defs.keys()) if (key.toLowerCase() === lower) return key;
    return undefined;
  }

  has(name: string): boolean {
    return this.resolveName(name) !== undefined;
  }

  get(name: string): GeneratorDefinition<any> | undefined {
    const resolved = this.resolveName(name);
    return resolved ? this.defs.get(resolved) : undefined;
  }

  list(): GeneratorDefinition<any>[] {
    return Array.from(this.defs.values());
  }

  names(): string[] {
    return Array.from(this.defs.keys());
  }

  /**
   * Register a custom generator. Function generators are an SDK-only feature:
   * configuration files and the browser playground cannot provide functions.
   */
  register(name: string, generate: GeneratorFn<any>, options: { description?: string; output?: GeneratorDefinition["output"] } = {}): void {
    if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(name)) {
      throw new GeneratorOptionsError(`Invalid generator name "${name}"`, name, "");
    }
    if (typeof generate !== "function") {
      throw new GeneratorOptionsError(`Generator "${name}" must be a function`, name, "");
    }
    this.defs.set(name, {
      name,
      category: "custom",
      description: options.description ?? "Custom generator",
      output: options.output ?? "any",
      options: z.record(z.string(), z.unknown()),
      generate,
    });
  }

  /** Validate options for a generator, returning parsed options with defaults applied. */
  parseOptions(name: string, options: Record<string, unknown>, path: string): Record<string, unknown> {
    const def = this.get(name);
    if (!def) {
      throw new GeneratorOptionsError(
        `Unknown generator "${name}" at "${path}". Run \`dataghost generators\` or see docs/generators.md for the list.`,
        name,
        path,
      );
    }
    const parsed = def.options.safeParse(options);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => {
        const where = i.path.length ? i.path.join(".") : "options";
        if (i.code === "unrecognized_keys") return `unknown option(s) ${i.keys.map((k) => `"${k}"`).join(", ")}`;
        return `${where}: ${i.message}`;
      });
      throw new GeneratorOptionsError(`Invalid options for generator "${def.name}" at "${path}": ${issues.join("; ")}`, def.name, path, issues);
    }
    return parsed.data as Record<string, unknown>;
  }
}

export const defaultRegistry = new GeneratorRegistry();
