import { existsSync } from "node:fs";
import path from "node:path";
import { parseArgs, type ParseArgsConfig } from "node:util";
import {
  CollectionGenerator,
  CollectionStats,
  DataGhost,
  DataGhostError,
  GENERATOR_VERSION,
  ReferentialIntegrityError,
  RecordTransformer,
  STARTER_CONFIG,
  buildReport,
  buildTransformReport,
  collectionFileName,
  columnsFromRecords,
  columnsFromSchema,
  inferFromStats,
  normalizeSchema,
  overridesFor,
  parseConfig,
  planTransformations,
  scaleCounts,
  toRelationshipConfigs,
  type DataFormat,
  type DataRecord,
  type Dataset,
  type DatasetConfig,
  type FileConfig,
  type InspectionReport,
  type OverrideMap,
  type RelationshipConfig,
  type SchemaInput,
  type Seed,
  type Transformation,
} from "@workfonic/dataghost";
import {
  CliError,
  EXIT,
  RecordWriter,
  jsonIsArray,
  loadDataset,
  outputFile,
  prepareOutDir,
  readJsonFile,
  resolveInput,
  streamRecords,
  writeTextFile,
  type InputFile,
  type OutputPolicy,
} from "./io.js";

export { EXIT, CliError } from "./io.js";
export const VERSION = "0.1.0";

export interface CliIO {
  cwd: string;
  stdout: (s: string) => void;
  stderr: (s: string) => void;
  /** Whether stderr is an interactive terminal (enables in-place progress). */
  isTTY?: boolean;
}

const DEFAULT_CONFIG = "dataghost.config.json";
const DEFAULT_OUT_DIR = "dataghost-output";
const DEFAULT_MAX_INPUT_MB = 100;
const FORMATS = ["json", "jsonl", "csv"] as const;
const MODES = ["synthetic", "mask", "preserve"] as const;

const HELP = `DataGhost ${VERSION} - realistic test data, zero real identities.

Usage: dataghost <command> [options]

Commands:
  init                      Create a starter dataghost.config.json
  inspect <file>            Infer schema, relationships and sensitive fields
  generate [file]           Generate synthetic, masked or structure-preserved data
  preview [file]            Print a few generated records without writing files
  validate <file>           Check generated data: schema, relationships, real-looking values
  export <file>             Convert a dataset to json, jsonl or csv
  generators                List available generators

Common options:
  -c, --config <file>       Config file (default: ./dataghost.config.json when no input file is given)
  -n, --count <n|name=n>    Records to generate; repeat name=n for per-collection counts
  -f, --format <fmt>        Output format: json, jsonl, csv
  -o, --out-dir <dir>       Output directory (default: ${DEFAULT_OUT_DIR})
  -s, --seed <seed>         Seed for reproducible output
  -m, --mode <mode>         synthetic (default), mask or preserve
      --overrides <file>    JSON file of schema overrides {"collection": {"path": spec}}
      --relationships <file> JSON file with an array of relationships
      --force               Overwrite existing output files
      --allow-outside-cwd   Allow an output directory outside the current directory
      --max-input-mb <n>    In-memory input limit (default ${DEFAULT_MAX_INPUT_MB})
      --json                Machine-readable output (inspect, validate)
  -q, --quiet               Only print errors
  -h, --help                Show help
  -v, --version             Show version

Exit codes: 0 ok, 1 validation failed, 2 usage, 3 input, 4 output, 5 config/schema, 6 generation, 70 internal.
DataGhost runs locally: no uploads, no telemetry.
`;

const COMMAND_HELP: Record<string, string> = {
  init: "Usage: dataghost init [--force]\n\nWrites dataghost.config.json with an example employees/departments dataset.\n",
  inspect: "Usage: dataghost inspect <file> [--json] [--out <config.json>] [--overrides <file>]\n\nPrints inferred fields, detected relationships and potential sensitive fields.\n--out writes a config you can edit and pass to `generate --config`.\n",
  generate:
    "Usage: dataghost generate [file] [--count n] [--format json|jsonl|csv] [--out-dir dir] [--seed s] [--mode synthetic|mask|preserve] [--config file]\n\nWith a file, the schema is inferred from it. Without one, collections come from the config.\nmask/preserve keep one output record per source record.\n",
  preview: "Usage: dataghost preview [file] [--count 5] [--seed s] [--mode m] [--config file]\n\nPrints generated records as JSON to stdout. Nothing is written.\n",
  validate:
    "Usage: dataghost validate <file> [--config file] [--schema schema.json] [--relationships file] [--no-safety] [--json]\n\nChecks schema conformance (when a schema or config is given), referential integrity and\nflags real-looking values (non-reserved email domains, Luhn-valid cards, real IPs, credential formats).\nExit code 1 when problems are found.\n",
  export: "Usage: dataghost export <file> --format json|jsonl|csv [--out-dir dir] [--force]\n\nConverts a dataset between formats. Multi-collection data becomes one file per collection for jsonl/csv.\n",
  generators: "Usage: dataghost generators [--json]\n",
};

const OPTIONS = {
  config: { type: "string", short: "c" },
  count: { type: "string", short: "n", multiple: true },
  format: { type: "string", short: "f" },
  "out-dir": { type: "string", short: "o" },
  out: { type: "string" },
  seed: { type: "string", short: "s" },
  mode: { type: "string", short: "m" },
  overrides: { type: "string" },
  relationships: { type: "string" },
  schema: { type: "string" },
  force: { type: "boolean" },
  "allow-outside-cwd": { type: "boolean" },
  "max-input-mb": { type: "string" },
  json: { type: "boolean" },
  "no-safety": { type: "boolean" },
  pretty: { type: "boolean" },
  compact: { type: "boolean" },
  quiet: { type: "boolean", short: "q" },
  help: { type: "boolean", short: "h" },
  version: { type: "boolean", short: "v" },
} satisfies ParseArgsConfig["options"];

type Flags = {
  config?: string;
  count?: string[];
  format?: string;
  "out-dir"?: string;
  out?: string;
  seed?: string;
  mode?: string;
  overrides?: string;
  relationships?: string;
  schema?: string;
  force?: boolean;
  "allow-outside-cwd"?: boolean;
  "max-input-mb"?: string;
  json?: boolean;
  "no-safety"?: boolean;
  pretty?: boolean;
  compact?: boolean;
  quiet?: boolean;
  help?: boolean;
  version?: boolean;
};

interface Ctx {
  io: CliIO;
  flags: Flags;
  log: (s: string) => void;
  warn: (s: string) => void;
}

// ---------------------------------------------------------------------------
// Option helpers
// ---------------------------------------------------------------------------

function parseSeed(v: string | undefined): Seed | undefined {
  if (v === undefined) return undefined;
  if (/^-?\d{1,15}$/.test(v)) return Number(v);
  if (v.length === 0 || v.length > 200) throw new CliError("--seed must be an integer or a string of up to 200 characters", EXIT.USAGE);
  return v;
}

function parseFormat(v: string | undefined): DataFormat | undefined {
  if (v === undefined) return undefined;
  if (!(FORMATS as readonly string[]).includes(v)) throw new CliError(`Unknown format "${v}". Use one of: ${FORMATS.join(", ")}`, EXIT.USAGE);
  return v as DataFormat;
}

function parseMode(v: string | undefined): (typeof MODES)[number] | undefined {
  if (v === undefined) return undefined;
  if (!(MODES as readonly string[]).includes(v)) throw new CliError(`Unknown mode "${v}". Use one of: ${MODES.join(", ")}`, EXIT.USAGE);
  return v as (typeof MODES)[number];
}

function parseCounts(values: string[] | undefined): number | Record<string, number> | undefined {
  if (!values?.length) return undefined;
  const per: Record<string, number> = {};
  let total: number | undefined;
  for (const v of values) {
    const m = /^(?:([A-Za-z0-9_][A-Za-z0-9_-]*)=)?(\d{1,9})$/.exec(v.trim());
    if (!m) throw new CliError(`Invalid --count "${v}". Use a number (100) or collection=number (employees=100)`, EXIT.USAGE);
    if (m[1]) per[m[1]] = Number(m[2]);
    else total = Number(m[2]);
  }
  if (total !== undefined && Object.keys(per).length) throw new CliError("Use either --count <n> or --count <collection>=<n>, not both", EXIT.USAGE);
  return total ?? per;
}

function maxBytes(flags: Flags, cfg?: FileConfig): number {
  const raw = flags["max-input-mb"];
  const mb = raw !== undefined ? Number(raw) : cfg?.limits?.maxInputMB ?? DEFAULT_MAX_INPUT_MB;
  if (!Number.isFinite(mb) || mb <= 0 || mb > 10_000) throw new CliError("--max-input-mb must be a number between 0 and 10000", EXIT.USAGE);
  return Math.floor(mb * 1048576);
}

async function loadConfig(ctx: Ctx, required: boolean): Promise<FileConfig | undefined> {
  const file = ctx.flags.config ?? (required && existsSync(path.join(ctx.io.cwd, DEFAULT_CONFIG)) ? DEFAULT_CONFIG : undefined);
  if (!file) return undefined;
  const raw = await readJsonFile(ctx.io.cwd, file, "Config");
  return parseConfig(raw);
}

async function loadOverrides(ctx: Ctx, cfg?: FileConfig): Promise<OverrideMap | undefined> {
  let o = cfg?.overrides as OverrideMap | undefined;
  if (ctx.flags.overrides) {
    const extra = await readJsonFile(ctx.io.cwd, ctx.flags.overrides, "Overrides");
    if (!extra || typeof extra !== "object" || Array.isArray(extra)) throw new CliError("Overrides file must contain a JSON object", EXIT.CONFIG);
    o = { ...(o ?? {}), ...(extra as OverrideMap) };
  }
  return o;
}

async function loadRelationships(ctx: Ctx, cfg?: FileConfig): Promise<RelationshipConfig[] | undefined> {
  let r = cfg?.relationships as RelationshipConfig[] | undefined;
  if (ctx.flags.relationships) {
    const extra = await readJsonFile(ctx.io.cwd, ctx.flags.relationships, "Relationships");
    const list = Array.isArray(extra) ? extra : (extra as { relationships?: unknown })?.relationships;
    if (!Array.isArray(list)) throw new CliError('Relationships file must contain an array (or {"relationships": [...]})', EXIT.CONFIG);
    parseConfig({ relationships: list });
    r = [...(r ?? []), ...(list as RelationshipConfig[])];
  }
  return r;
}

function policy(ctx: Ctx, inputs: InputFile[]): OutputPolicy {
  return { cwd: ctx.io.cwd, force: !!ctx.flags.force, allowOutsideCwd: !!ctx.flags["allow-outside-cwd"], protectedPaths: inputs.map((i) => i.realPath) };
}

function makeProgress(ctx: Ctx, label: string, total: number) {
  let last = 0;
  const enabled = !ctx.flags.quiet && total >= 10_000;
  return {
    tick(done: number) {
      if (!enabled) return;
      const now = Date.now();
      if (now - last < 500 && done < total) return;
      last = now;
      const pct = Math.floor((done / total) * 100);
      if (ctx.io.isTTY) ctx.io.stderr(`\r${label}: ${done.toLocaleString("en-US")}/${total.toLocaleString("en-US")} (${pct}%)`);
      else if (done === total || pct % 25 === 0) ctx.io.stderr(`${label}: ${pct}%\n`);
    },
    done() {
      if (enabled && ctx.io.isTTY) ctx.io.stderr("\n");
    },
  };
}

function size(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

function pad(s: string, n: number): string {
  return s.length >= n ? s.slice(0, n - 1) + " " : s + " ".repeat(n - s.length);
}

function seedNote(ctx: Ctx, seed: Seed, configured: boolean) {
  if (!configured) ctx.log(`Seed: ${seed} (not configured; pass --seed ${seed} to reproduce this output)`);
  else ctx.log(`Seed: ${seed} (generator version ${GENERATOR_VERSION})`);
}

// ---------------------------------------------------------------------------
// Input handling
// ---------------------------------------------------------------------------

interface LoadedInput {
  input: InputFile;
  /** Present when the whole dataset fits in memory. */
  dataset?: Dataset;
  /** Present for streamed single-collection inputs. */
  streamed?: { name: string };
}

async function openInput(ctx: Ctx, file: string, limit: number): Promise<LoadedInput> {
  const input = resolveInput(ctx.io.cwd, file);
  if (input.size <= limit) return { input, dataset: await loadDataset(input, limit) };
  const streamable = input.format !== "json" || (await jsonIsArray(input.path));
  if (!streamable) {
    throw new CliError(
      `${path.basename(input.path)} is ${size(input.size)} and holds several collections in one JSON object, which must be loaded into memory (limit ${size(limit)})`,
      EXIT.INPUT,
      "Raise --max-input-mb, or split it into one JSON array/JSONL/CSV file per collection.",
    );
  }
  ctx.log(`${path.basename(input.path)} is ${size(input.size)}; streaming it instead of loading it into memory.`);
  return { input, streamed: { name: input.base } };
}

async function inspectInput(ctx: Ctx, loaded: LoadedInput, overrides?: OverrideMap): Promise<InspectionReport> {
  const ghost = new DataGhost({ seed: 0 });
  if (loaded.dataset) return ghost.inspect(loaded.dataset, { overrides });
  const name = loaded.streamed!.name;
  const stats = new CollectionStats();
  let n = 0;
  for await (const r of streamRecords(loaded.input)) {
    stats.add(r);
    if (++n % 100_000 === 0 && !ctx.flags.quiet) ctx.io.stderr(`Inspecting: ${n.toLocaleString("en-US")} records\n`);
  }
  const inference = inferFromStats(stats, { name, overrides: overridesFor(name, [name], overrides) });
  ctx.warn("Relationship detection is skipped for streamed input; configure relationships explicitly if needed.");
  return buildReport([inference], []);
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

/** File-name-safe version of an input base name (dots allowed, no leading dot). */
function safeBase(base: string): string {
  return base.replace(/[^A-Za-z0-9._-]/g, "_").replace(/^[._-]+/, "").slice(0, 100) || "data";
}

function fileNameFor(base: string, collection: string | undefined, mode: string, format: DataFormat): string {
  const parts = [safeBase(base)];
  if (collection) parts.push(collectionFileName(collection));
  parts.push(mode === "synthetic" ? "synthetic" : mode === "mask" ? "masked" : "preserved");
  return `${parts.join(".")}.${format}`;
}

async function writeDataset(ctx: Ctx, data: Dataset, format: DataFormat, outDir: string, base: string, mode: string, pol: OutputPolicy, pretty: boolean): Promise<string[]> {
  const names = Object.keys(data);
  const files: string[] = [];
  if (format === "json") {
    const target = outputFile(outDir, fileNameFor(base, undefined, mode, format), pol);
    const body = names.length === 1 ? data[names[0]!] : data;
    await writeTextFile(target, JSON.stringify(body, null, pretty ? 2 : undefined) + "\n");
    files.push(target);
    return files;
  }
  for (const name of names) {
    const target = outputFile(outDir, fileNameFor(base, names.length === 1 ? undefined : name, mode, format), pol);
    const records = data[name]!;
    const w = new RecordWriter(target, format, { columns: format === "csv" ? columnsFromRecords(records) : undefined, pretty });
    try {
      for (const r of records) await w.add(r);
      await w.close();
    } catch (e) {
      await w.abort();
      throw e;
    }
    files.push(target);
  }
  return files;
}

function reportFiles(ctx: Ctx, files: string[], counts: Record<string, number>) {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  ctx.log(`Wrote ${total.toLocaleString("en-US")} record(s) to:`);
  for (const f of files) ctx.log(`  ${path.relative(ctx.io.cwd, f) || f}`);
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

async function cmdInit(ctx: Ctx): Promise<number> {
  const target = path.join(ctx.io.cwd, DEFAULT_CONFIG);
  if (existsSync(target) && !ctx.flags.force) throw new CliError(`${DEFAULT_CONFIG} already exists`, EXIT.OUTPUT, "Pass --force to overwrite it.");
  if (existsSync(target)) {
    const { rm } = await import("node:fs/promises");
    await rm(target);
  }
  await writeTextFile(target, JSON.stringify(STARTER_CONFIG, null, 2) + "\n");
  ctx.log(`Created ${DEFAULT_CONFIG} with an example departments/employees dataset.`);
  ctx.log("Next: dataghost preview   (or)   dataghost generate --format csv");
  return EXIT.OK;
}

function printInspection(ctx: Ctx, report: InspectionReport, input: InputFile) {
  ctx.io.stdout(`DataGhost inspect: ${path.basename(input.path)} (${input.format.toUpperCase()}, ${size(input.size)})\n`);
  for (const c of report.collections) {
    ctx.io.stdout(`\nCollection "${c.name}": ${c.recordCount.toLocaleString("en-US")} records, ${c.fieldCount} fields\n`);
    ctx.io.stdout(`  ${pad("PATH", 28)}${pad("TYPE", 10)}${pad("SEMANTIC", 16)}${pad("CONF", 6)}${pad("NULL", 6)}${pad("PRIVACY", 22)}GENERATOR\n`);
    for (const f of c.fields) {
      if (f.type === "object") continue;
      const priv = f.privacy?.category ? `${f.privacy.category} (${f.privacy.level})${f.privacy.uncertain ? "?" : ""}` : "-";
      const nul = f.nullable ? `${Math.round(f.nullRate * 100)}%` : f.optional ? "opt" : "-";
      ctx.io.stdout(`  ${pad(f.path, 28)}${pad(f.type, 10)}${pad(f.semanticType ?? "-", 16)}${pad(f.confidence.toFixed(2), 6)}${pad(nul, 6)}${pad(priv, 22)}${f.suggestedGenerator?.type ?? "-"}${f.overridden ? " (override)" : ""}\n`);
    }
    for (const w of c.warnings) ctx.io.stdout(`  ! ${w}\n`);
    const fieldWarnings = c.fields.filter((f) => f.warnings.length);
    for (const f of fieldWarnings) for (const w of f.warnings) ctx.io.stdout(`  ! ${f.path}: ${w}\n`);
  }
  ctx.io.stdout(`\nRelationships (detected, review before relying on them):\n`);
  if (!report.relationships.length) ctx.io.stdout("  none detected\n");
  for (const r of report.relationships) ctx.io.stdout(`  ${r.from} -> ${r.to}  ${r.type}  confidence ${r.confidence.toFixed(2)}  (${r.reason})\n`);
  ctx.io.stdout(`\nPrivacy: ${report.totals.sensitiveFields} potentially sensitive field(s), ${report.totals.uncertainFields} uncertain\n`);
  for (const f of report.privacy.fields) {
    ctx.io.stdout(`  ${pad(`${f.collection}.${f.path}`, 36)}${pad(f.category, 16)}${pad(f.level, 8)}confidence ${f.confidence.toFixed(2)}${f.uncertain ? " (uncertain)" : ""}  mask: ${f.defaultTransformation}\n`);
  }
  for (const w of report.privacy.warnings) ctx.io.stdout(`  ! ${w}\n`);
  ctx.io.stdout(`\nDetection is not protection. ${report.privacy.limitations[0]}\n`);
}

async function cmdInspect(ctx: Ctx, file: string | undefined): Promise<number> {
  if (!file) throw new CliError("inspect needs an input file", EXIT.USAGE, "Example: dataghost inspect ./data.json");
  const cfg = await loadConfig(ctx, false);
  const loaded = await openInput(ctx, file, maxBytes(ctx.flags, cfg));
  const report = await inspectInput(ctx, loaded, await loadOverrides(ctx, cfg));
  if (ctx.flags.out) {
    const pol = policy(ctx, [loaded.input]);
    const outPath = path.resolve(ctx.io.cwd, ctx.flags.out);
    const dir = await prepareOutDir(path.dirname(outPath), pol);
    const target = outputFile(dir, path.basename(outPath), pol);
    const config: FileConfig = {
      seed: 12345,
      mode: "synthetic",
      collections: Object.fromEntries(report.collections.map((c) => [c.name, { count: c.recordCount, schema: c.schema as Record<string, unknown> }])),
      relationships: toRelationshipConfigs(report.relationships) as FileConfig["relationships"],
    };
    await writeTextFile(target, JSON.stringify(config, null, 2) + "\n");
    ctx.log(`Wrote editable config to ${path.relative(ctx.io.cwd, target)}`);
  }
  if (ctx.flags.json) ctx.io.stdout(JSON.stringify(report, null, 2) + "\n");
  else printInspection(ctx, report, loaded.input);
  return EXIT.OK;
}

interface GenerationPlan {
  mode: (typeof MODES)[number];
  seed: Seed;
  seedConfigured: boolean;
  format: DataFormat;
  outDir: string;
  pretty: boolean;
  cfg?: FileConfig;
  counts?: number | Record<string, number>;
  overrides?: OverrideMap;
  relationships?: RelationshipConfig[];
}

async function planFromFlags(ctx: Ctx, needConfig: boolean): Promise<GenerationPlan> {
  const cfg = await loadConfig(ctx, needConfig);
  const flagSeed = parseSeed(ctx.flags.seed);
  const seed = flagSeed ?? cfg?.seed ?? Math.floor(Math.random() * 2 ** 31);
  return {
    mode: parseMode(ctx.flags.mode) ?? cfg?.mode ?? "synthetic",
    seed,
    seedConfigured: flagSeed !== undefined || cfg?.seed !== undefined,
    format: parseFormat(ctx.flags.format) ?? cfg?.output?.format ?? "json",
    outDir: ctx.flags["out-dir"] ?? cfg?.output?.dir ?? DEFAULT_OUT_DIR,
    pretty: ctx.flags.compact ? false : ctx.flags.pretty ?? cfg?.output?.pretty ?? true,
    cfg,
    counts: parseCounts(ctx.flags.count),
    overrides: await loadOverrides(ctx, cfg),
    relationships: await loadRelationships(ctx, cfg),
  };
}

function configFromFile(plan: GenerationPlan): DatasetConfig {
  const cols = plan.cfg?.collections;
  if (!cols || !Object.keys(cols).length) {
    throw new CliError("No input file and no collections in the config", EXIT.USAGE, "Pass a data file (dataghost generate ./data.json) or run `dataghost init` to create a config.");
  }
  const source: Record<string, number> = {};
  for (const [name, c] of Object.entries(cols)) {
    if (!c.schema) throw new CliError(`Collection "${name}" in the config has no schema`, EXIT.CONFIG);
    source[name] = c.count ?? 10;
  }
  const counts = typeof plan.counts === "number" ? Object.fromEntries(Object.keys(source).map((k) => [k, plan.counts as number])) : scaleCounts(source, plan.counts);
  return {
    collections: Object.fromEntries(Object.entries(cols).map(([name, c]) => [name, { schema: c.schema as SchemaInput, count: counts[name]! }])),
    relationships: plan.relationships,
  };
}

/** Previews generate a small dataset, scaled proportionally so relationships stay feasible. */
function shrinkForPreview(config: DatasetConfig, preview: number) {
  const source = Object.fromEntries(Object.entries(config.collections).map(([k, c]) => [k, c.count]));
  const largest = Math.max(0, ...Object.values(source));
  const scaled = scaleCounts(source, Math.min(largest, Math.max(preview, 100)));
  for (const [k, c] of Object.entries(config.collections)) c.count = scaled[k]!;
}

/** Collections that take part in no relationship can be streamed straight to disk. */
function independent(config: DatasetConfig): boolean {
  return !config.relationships?.length;
}

async function generateFromConfig(ctx: Ctx, config: DatasetConfig, plan: GenerationPlan, base: string, pol: OutputPolicy, preview?: number): Promise<number> {
  const ghost = new DataGhost({ seed: plan.seed, referenceDate: plan.cfg?.referenceDate });
  const names = Object.keys(config.collections);
  if (preview !== undefined) {
    const { data } = await ghost.generateDataset(config);
    const out = Object.fromEntries(names.map((n) => [n, data[n]!.slice(0, preview)]));
    ctx.io.stdout(JSON.stringify(names.length === 1 ? out[names[0]!] : out, null, 2) + "\n");
    return EXIT.OK;
  }
  const outDir = await prepareOutDir(plan.outDir, pol);
  const streamable = independent(config) && (plan.format !== "json" || names.length === 1);
  if (streamable) {
    const files: string[] = [];
    const counts: Record<string, number> = {};
    for (const name of names) {
      const schema = normalizeSchema(config.collections[name]!.schema, { registry: ghost.registry });
      const count = config.collections[name]!.count;
      const gen = new CollectionGenerator(name, schema, { seed: plan.seed, registry: ghost.registry, referenceDate: ghost.referenceDate });
      const target = outputFile(outDir, fileNameFor(base, names.length === 1 ? undefined : name, plan.mode, plan.format), pol);
      const w = new RecordWriter(target, plan.format, { columns: plan.format === "csv" ? columnsFromSchema(schema) : undefined, pretty: plan.pretty });
      const progress = makeProgress(ctx, `Generating ${name}`, count);
      try {
        for (let i = 0; i < count; i++) {
          await w.add(gen.next());
          progress.tick(i + 1);
        }
        await w.close();
      } catch (e) {
        await w.abort();
        throw e;
      }
      progress.done();
      counts[name] = count;
      files.push(target);
    }
    reportFiles(ctx, files, counts);
    return EXIT.OK;
  }
  const { data, report } = await ghost.generateDataset(config);
  const files = await writeDataset(ctx, data, plan.format, outDir, base, plan.mode, pol, plan.pretty);
  reportFiles(ctx, files, report.counts);
  for (const s of report.integrity.stats) {
    ctx.log(`Relationship ${s.relationship}: ${s.references} reference(s), ${s.danglingReferences} invalid, ${s.nullReferences} null`);
  }
  return EXIT.OK;
}

async function cmdGenerate(ctx: Ctx, file: string | undefined, preview?: number): Promise<number> {
  const plan = await planFromFlags(ctx, !file);
  if (!ctx.flags.quiet && preview === undefined) seedNote(ctx, plan.seed, plan.seedConfigured);

  if (!file) {
    if (plan.mode !== "synthetic") throw new CliError(`--mode ${plan.mode} needs an input file to transform`, EXIT.USAGE);
    const config = configFromFile(plan);
    if (preview !== undefined && plan.counts === undefined) shrinkForPreview(config, preview);
    return generateFromConfig(ctx, config, plan, "dataghost", policy(ctx, []), preview);
  }

  const limit = maxBytes(ctx.flags, plan.cfg);
  const loaded = await openInput(ctx, file, limit);
  const pol = policy(ctx, [loaded.input]);
  const report = await inspectInput(ctx, loaded, plan.overrides);
  if (!ctx.flags.quiet && preview === undefined) {
    ctx.log(`Inspected ${report.totals.records.toLocaleString("en-US")} record(s) in ${report.totals.collections} collection(s); ${report.totals.sensitiveFields} potentially sensitive field(s).`);
  }

  if (plan.mode === "synthetic") {
    const ghost = new DataGhost({ seed: plan.seed, referenceDate: plan.cfg?.referenceDate });
    const config = ghost.configFromInspection(report, { count: plan.counts, relationships: plan.relationships, useDetectedRelationships: plan.cfg?.detectRelationships !== false });
    if (preview !== undefined && plan.counts === undefined) shrinkForPreview(config, preview);
    return generateFromConfig(ctx, config, plan, loaded.input.base, pol, preview);
  }

  // mask / preserve
  const transformations = plan.cfg?.transformations as Record<string, Transformation> | undefined;
  const relationships = plan.relationships ?? toRelationshipConfigs(report.relationships);
  if (plan.counts !== undefined) ctx.warn(`--count is ignored in ${plan.mode} mode: one output record is produced per source record.`);
  const ghost = new DataGhost({ seed: plan.seed, referenceDate: plan.cfg?.referenceDate });
  const options = { mode: plan.mode, seed: plan.seed, transformations, relationships, keep: plan.cfg?.keep, referenceDate: ghost.referenceDate } as const;

  if (loaded.dataset) {
    const { transformDataset } = await import("@workfonic/dataghost");
    const { data, report: tr } = transformDataset(loaded.dataset, report, ghost.registry, options);
    if (preview !== undefined) {
      const names = Object.keys(data);
      const out = Object.fromEntries(names.map((n) => [n, data[n]!.slice(0, preview)]));
      ctx.io.stdout(JSON.stringify(names.length === 1 ? out[names[0]!] : out, null, 2) + "\n");
      return EXIT.OK;
    }
    const outDir = await prepareOutDir(plan.outDir, pol);
    const files = await writeDataset(ctx, data, plan.format, outDir, loaded.input.base, plan.mode, pol, plan.pretty);
    reportFiles(ctx, files, Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v.length])));
    printTransformSummary(ctx, tr);
    if (tr.integrity && !tr.integrity.valid) return EXIT.GENERATION;
    return EXIT.OK;
  }

  // Streamed single collection: second pass transforms record by record.
  const plans = planTransformations(report, options);
  const transformer = new RecordTransformer(ghost.registry, options);
  const plan0 = plans[0]!;
  if (preview !== undefined) {
    const out: DataRecord[] = [];
    for await (const r of streamRecords(loaded.input)) {
      out.push(transformer.transform(r, plan0));
      if (out.length >= preview) break;
    }
    ctx.io.stdout(JSON.stringify(out, null, 2) + "\n");
    return EXIT.OK;
  }
  const outDir = await prepareOutDir(plan.outDir, pol);
  const target = outputFile(outDir, fileNameFor(loaded.input.base, undefined, plan.mode, plan.format), pol);
  const inferred = report.collections[0]!;
  let columns: string[] | undefined;
  if (plan.format === "csv") columns = columnsFromSchema(normalizeSchema(inferred.schema, { registry: ghost.registry }));
  const w = new RecordWriter(target, plan.format, { columns, pretty: plan.pretty });
  const progress = makeProgress(ctx, `Transforming`, inferred.recordCount);
  let n = 0;
  try {
    for await (const r of streamRecords(loaded.input)) {
      await w.add(transformer.transform(r, plan0));
      progress.tick(++n);
    }
    await w.close();
  } catch (e) {
    await w.abort();
    throw e;
  }
  progress.done();
  reportFiles(ctx, [target], { [plan0.name]: n });
  printTransformSummary(ctx, buildTransformReport(plans, options, { [plan0.name]: { length: n } }));
  return EXIT.OK;
}

function printTransformSummary(ctx: Ctx, tr: ReturnType<typeof buildTransformReport>) {
  if (ctx.flags.quiet) return;
  const changed = tr.collections.flatMap((c) => c.fields.filter((f) => f.transformation !== "keep").map((f) => `${c.name}.${f.path} -> ${f.transformation}`));
  ctx.log(`${tr.mode === "mask" ? "Masked" : "Replaced"} ${changed.length} field(s):`);
  for (const c of changed.slice(0, 50)) ctx.log(`  ${c}`);
  if (changed.length > 50) ctx.log(`  ... and ${changed.length - 50} more`);
  if (tr.integrity) ctx.log(`Referential integrity after transformation: ${tr.integrity.valid ? "valid" : `${tr.integrity.issues.length} issue(s)`}`);
  for (const w of tr.warnings) ctx.warn(w);
  ctx.log(`Note: ${tr.limitations[1]}`);
}

async function cmdValidate(ctx: Ctx, file: string | undefined): Promise<number> {
  if (!file) throw new CliError("validate needs a file", EXIT.USAGE, "Example: dataghost validate ./dataghost-output/data.synthetic.json");
  const cfg = await loadConfig(ctx, false);
  const input = resolveInput(ctx.io.cwd, file);
  const dataset = await loadDataset(input, maxBytes(ctx.flags, cfg));
  const ghost = new DataGhost({ seed: 0 });
  const names = Object.keys(dataset);
  let schemas: Record<string, SchemaInput> | undefined;
  if (cfg?.collections) {
    schemas = {};
    for (const [n, c] of Object.entries(cfg.collections)) if (c.schema && dataset[n]) schemas[n] = c.schema as SchemaInput;
    // Single-collection output files are named after the input, not the collection.
    if (names.length === 1 && !Object.keys(schemas).length && Object.keys(cfg.collections).length === 1) {
      const only = Object.values(cfg.collections)[0]!;
      if (only.schema) schemas[names[0]!] = only.schema as SchemaInput;
    }
  }
  if (ctx.flags.schema) {
    const s = await readJsonFile(ctx.io.cwd, ctx.flags.schema, "Schema");
    if (!s || typeof s !== "object" || Array.isArray(s)) throw new CliError("Schema file must contain a JSON object", EXIT.CONFIG);
    schemas = { ...(schemas ?? {}), [names[0]!]: s as SchemaInput };
  }
  let relationships = await loadRelationships(ctx, cfg);
  let detected = false;
  if (!relationships) {
    relationships = toRelationshipConfigs(ghost.inspect(dataset).relationships);
    detected = relationships.length > 0;
  }
  const result = ghost.validateDataset(dataset, { schemas, relationships, safetyScan: !ctx.flags["no-safety"] });
  const report = ghost.inspect(dataset);
  const structural = report.collections.flatMap((c) => c.fields.filter((f) => f.warnings.some((w) => w.startsWith("Mixed"))).map((f) => `${c.name}.${f.path}: ${f.warnings.find((w) => w.startsWith("Mixed"))}`));

  if (ctx.flags.json) {
    ctx.io.stdout(JSON.stringify({ ...result, detectedRelationships: detected ? relationships : [], structuralWarnings: structural }, null, 2) + "\n");
    return result.valid ? EXIT.OK : EXIT.VALIDATION_FAILED;
  }
  const out = ctx.io.stdout;
  out(`DataGhost validate: ${path.basename(input.path)} (${names.length} collection(s), ${names.reduce((n, k) => n + dataset[k]!.length, 0).toLocaleString("en-US")} records)\n`);
  if (schemas && Object.keys(schemas).length) {
    for (const [n, r] of Object.entries(result.schema)) {
      out(`  Schema ${n}: ${r.valid ? "ok" : `${r.errors.length}${r.truncated ? "+" : ""} error(s)`} (${r.checked} records)\n`);
      for (const e of r.errors.slice(0, 20)) out(`    x record ${e.recordIndex} ${e.path}: ${e.message}\n`);
      if (r.warnings.length) out(`    ${r.warnings.length} warning(s), e.g. ${r.warnings[0]!.path}: ${r.warnings[0]!.message}\n`);
    }
  } else out("  Schema: not checked (pass --config or --schema)\n");
  if (result.integrity) {
    out(`  Relationships${detected ? " (detected)" : ""}: ${result.integrity.valid ? "ok" : `${result.integrity.issues.length} issue(s)`}\n`);
    for (const s of result.integrity.stats) out(`    ${s.relationship}: ${s.references} reference(s), ${s.danglingReferences} invalid\n`);
    for (const i of result.integrity.issues.slice(0, 20)) out(`    x ${i.message}\n`);
  } else out("  Relationships: none configured or detected\n");
  if (!ctx.flags["no-safety"]) {
    out(`  Real-looking values: ${result.safety.length ? `${result.safety.length}${result.safetyTruncated ? "+" : ""} found` : "none found"}\n`);
    for (const f of result.safety.slice(0, 20)) out(`    x ${f.location}: ${f.message}\n`);
  }
  for (const s of structural) out(`  ! ${s}\n`);
  out(result.valid ? "Result: valid\n" : "Result: problems found\n");
  return result.valid ? EXIT.OK : EXIT.VALIDATION_FAILED;
}

async function cmdExport(ctx: Ctx, file: string | undefined): Promise<number> {
  if (!file) throw new CliError("export needs a file", EXIT.USAGE, "Example: dataghost export ./generated.json --format jsonl");
  const format = parseFormat(ctx.flags.format);
  if (!format) throw new CliError("export needs --format json, jsonl or csv", EXIT.USAGE);
  const cfg = await loadConfig(ctx, false);
  const limit = maxBytes(ctx.flags, cfg);
  const loaded = await openInput(ctx, file, limit);
  const pol = policy(ctx, [loaded.input]);
  const outDir = await prepareOutDir(ctx.flags["out-dir"] ?? cfg?.output?.dir ?? DEFAULT_OUT_DIR, pol);
  const pretty = ctx.flags.compact ? false : ctx.flags.pretty ?? true;
  const base = safeBase(loaded.input.base);
  if (loaded.dataset) {
    const names = Object.keys(loaded.dataset);
    const files: string[] = [];
    if (format === "json") {
      const target = outputFile(outDir, `${base}.json`, pol);
      await writeTextFile(target, JSON.stringify(names.length === 1 ? loaded.dataset[names[0]!] : loaded.dataset, null, pretty ? 2 : undefined) + "\n");
      files.push(target);
    } else {
      for (const n of names) {
        const target = outputFile(outDir, names.length === 1 ? `${base}.${format}` : `${base}.${collectionFileName(n)}.${format}`, pol);
        const recs = loaded.dataset[n]!;
        const w = new RecordWriter(target, format, { columns: format === "csv" ? columnsFromRecords(recs) : undefined, pretty });
        for (const r of recs) await w.add(r);
        await w.close();
        files.push(target);
      }
    }
    reportFiles(ctx, files, Object.fromEntries(names.map((n) => [n, loaded.dataset![n]!.length])));
    return EXIT.OK;
  }
  // Streamed single collection. CSV needs columns up front: take them from a first pass.
  let columns: string[] | undefined;
  if (format === "csv") {
    const seen = new Set<string>();
    const { flattenRecord } = await import("@workfonic/dataghost");
    for await (const r of streamRecords(loaded.input)) for (const k of Object.keys(flattenRecord(r))) seen.add(k);
    columns = Array.from(seen);
  }
  const target = outputFile(outDir, `${base}.${format}`, pol);
  const w = new RecordWriter(target, format, { columns, pretty });
  let n = 0;
  try {
    for await (const r of streamRecords(loaded.input)) {
      await w.add(r);
      n++;
    }
    await w.close();
  } catch (e) {
    await w.abort();
    throw e;
  }
  reportFiles(ctx, [target], { [base]: n });
  return EXIT.OK;
}

function cmdGenerators(ctx: Ctx): number {
  const ghost = new DataGhost({ seed: 0 });
  const list = ghost.generators();
  if (ctx.flags.json) {
    ctx.io.stdout(JSON.stringify(list, null, 2) + "\n");
    return EXIT.OK;
  }
  let cat = "";
  for (const g of list.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name))) {
    if (g.category !== cat) {
      cat = g.category;
      ctx.io.stdout(`\n${cat}\n`);
    }
    ctx.io.stdout(`  ${pad(g.name, 18)}${g.description}\n`);
  }
  return EXIT.OK;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

function errorExit(e: unknown): { code: number; message: string; hint?: string } {
  if (e instanceof CliError) return { code: e.exitCode, message: e.message, hint: e.hint };
  if (e instanceof ReferentialIntegrityError) return { code: EXIT.GENERATION, message: e.message };
  if (e instanceof DataGhostError) {
    const map: Record<string, number> = {
      INVALID_SCHEMA: EXIT.CONFIG,
      INVALID_CONFIG: EXIT.CONFIG,
      PARSE_ERROR: EXIT.INPUT,
      LIMIT_EXCEEDED: EXIT.INPUT,
      GENERATION_ERROR: EXIT.GENERATION,
      VALIDATION_ERROR: EXIT.VALIDATION_FAILED,
      UNSUPPORTED: EXIT.USAGE,
    };
    const details = e.details.length > 1 ? `\n  - ${e.details.join("\n  - ")}` : "";
    return { code: map[e.code] ?? EXIT.INTERNAL, message: e.message + details, hint: e.code === "LIMIT_EXCEEDED" ? "Raise --max-input-mb or use JSONL/CSV, which stream." : undefined };
  }
  const err = e as NodeJS.ErrnoException;
  if (err?.code === "EACCES" || err?.code === "EPERM") return { code: EXIT.OUTPUT, message: `Permission denied: ${err.path ?? ""}` };
  if (err?.code === "ENOSPC") return { code: EXIT.OUTPUT, message: "No space left on device" };
  if (err?.name === "RelationshipConfigError" || err?.name === "CircularDependencyError" || err?.name === "PathError") return { code: EXIT.CONFIG, message: err.message };
  return { code: EXIT.INTERNAL, message: `Unexpected error: ${err?.message ?? String(e)}` };
}

/** Run the CLI. Returns the process exit code. */
export async function run(argv: string[], io: CliIO): Promise<number> {
  let parsed: { values: Flags; positionals: string[] };
  try {
    parsed = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: true }) as unknown as { values: Flags; positionals: string[] };
  } catch (e) {
    io.stderr(`Error: ${(e as Error).message}\nRun "dataghost --help" for usage.\n`);
    return EXIT.USAGE;
  }
  const { values: flags, positionals } = parsed;
  const [command, file, ...rest] = positionals;
  const ctx: Ctx = {
    io,
    flags,
    log: (s) => {
      if (!flags.quiet) io.stderr(s + "\n");
    },
    warn: (s) => {
      if (!flags.quiet) io.stderr(`Warning: ${s}\n`);
    },
  };
  if (flags.version) {
    io.stdout(`${VERSION} (generators ${GENERATOR_VERSION})\n`);
    return EXIT.OK;
  }
  if (!command || command === "help") {
    io.stdout(command === "help" && file && COMMAND_HELP[file] ? COMMAND_HELP[file]! : HELP);
    return command ? EXIT.OK : flags.help ? EXIT.OK : EXIT.USAGE;
  }
  if (flags.help) {
    io.stdout(COMMAND_HELP[command] ?? HELP);
    return EXIT.OK;
  }
  if (rest.length) {
    io.stderr(`Error: unexpected argument(s): ${rest.join(" ")}\n`);
    return EXIT.USAGE;
  }
  try {
    switch (command) {
      case "init":
        return await cmdInit(ctx);
      case "inspect":
        return await cmdInspect(ctx, file);
      case "generate":
        return await cmdGenerate(ctx, file);
      case "preview": {
        const counts = parseCounts(flags.count);
        const n = typeof counts === "number" ? counts : 5;
        if (typeof counts === "number") flags.count = undefined;
        if (n > 1000) throw new CliError("preview shows at most 1000 records; use generate for more", EXIT.USAGE);
        return await cmdGenerate(ctx, file, n);
      }
      case "validate":
        return await cmdValidate(ctx, file);
      case "export":
        return await cmdExport(ctx, file);
      case "generators":
        return cmdGenerators(ctx);
      default:
        io.stderr(`Error: unknown command "${command}"\nRun "dataghost --help" for the list of commands.\n`);
        return EXIT.USAGE;
    }
  } catch (e) {
    const { code, message, hint } = errorExit(e);
    io.stderr(`Error: ${message}\n${hint ? `Hint: ${hint}\n` : ""}`);
    return code;
  }
}

