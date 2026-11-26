import { createReadStream, createWriteStream, existsSync, promises as fs, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import { once } from "node:events";
import {
  CsvStreamParser,
  JsonArrayStreamParser,
  LimitError,
  ParseError,
  csvHeader,
  csvRow,
  detectFormat,
  parseJsonlLine,
  parseText,
  toDataset,
  type DataFormat,
  type DataRecord,
  type Dataset,
} from "@workfonic/dataghost";

export class CliError extends Error {
  constructor(
    message: string,
    readonly exitCode: number,
    readonly hint?: string,
  ) {
    super(message);
    this.name = "CliError";
  }
}

export const EXIT = {
  OK: 0,
  VALIDATION_FAILED: 1,
  USAGE: 2,
  INPUT: 3,
  OUTPUT: 4,
  CONFIG: 5,
  GENERATION: 6,
  INTERNAL: 70,
} as const;

export interface InputFile {
  path: string;
  realPath: string;
  size: number;
  format: DataFormat;
  /** File name without directory and extension. */
  base: string;
}

export function resolveInput(cwd: string, file: string, formatHint?: DataFormat): InputFile {
  if (file.includes("\0")) throw new CliError("Input path contains a null byte", EXIT.USAGE);
  const p = path.resolve(cwd, file);
  if (!existsSync(p)) throw new CliError(`Input file not found: ${file}`, EXIT.INPUT, "Check the path, or run `dataghost init` to create an example config.");
  const st = statSync(p);
  if (!st.isFile()) throw new CliError(`Input is not a regular file: ${file}`, EXIT.INPUT);
  const format = formatHint ?? detectFormat(p);
  const base = path.basename(p).replace(/\.(json|jsonl|ndjson|csv|tsv)$/i, "");
  return { path: p, realPath: realpathSync(p), size: st.size, format, base };
}

/** Load a whole input file as a dataset (bounded by maxBytes). */
export async function loadDataset(input: InputFile, maxBytes: number): Promise<Dataset> {
  if (input.size > maxBytes) {
    throw new LimitError(`${path.basename(input.path)} is ${(input.size / 1048576).toFixed(1)} MB, above the ${(maxBytes / 1048576).toFixed(0)} MB in-memory limit`);
  }
  const text = await fs.readFile(input.path, "utf8");
  return toDataset(parseText(text, input.format, maxBytes), input.base);
}

/**
 * Stream records from a single-collection file without loading it fully.
 * JSONL and CSV stream natively; JSON files must be a top-level array.
 */
export async function* streamRecords(input: InputFile): AsyncGenerator<DataRecord> {
  if (input.format === "jsonl") {
    const rl = createInterface({ input: createReadStream(input.path, { encoding: "utf8" }), crlfDelay: Infinity });
    let line = 0;
    for await (const text of rl) {
      line++;
      const v = parseJsonlLine(text, line);
      if (v === undefined) continue;
      if (v === null || typeof v !== "object" || Array.isArray(v)) throw new ParseError(`Line ${line} is not a JSON object`, line);
      yield v as DataRecord;
    }
    return;
  }
  const stream = createReadStream(input.path, { encoding: "utf8", highWaterMark: 1 << 20 });
  if (input.format === "csv") {
    const p = new CsvStreamParser();
    for await (const chunk of stream) for (const r of p.push(chunk as string)) yield r as DataRecord;
    for (const r of p.end()) yield r as DataRecord;
    return;
  }
  const p = new JsonArrayStreamParser();
  let i = 0;
  for await (const chunk of stream) {
    for (const v of p.push(chunk as string)) {
      if (v === null || typeof v !== "object" || Array.isArray(v)) throw new ParseError(`Array element ${i} is not an object`);
      i++;
      yield v as DataRecord;
    }
  }
  p.end();
}

/** Peek whether a JSON file is a top-level array (streamable) or an object. */
export async function jsonIsArray(file: string): Promise<boolean> {
  const fh = await fs.open(file, "r");
  try {
    const buf = Buffer.alloc(4096);
    const { bytesRead } = await fh.read(buf, 0, 4096, 0);
    const s = buf.subarray(0, bytesRead).toString("utf8").replace(/^\uFEFF/, "").trimStart();
    return s.startsWith("[");
  } finally {
    await fh.close();
  }
}

export interface OutputPolicy {
  cwd: string;
  force: boolean;
  allowOutsideCwd: boolean;
  /** Real paths of input files, which must never be overwritten. */
  protectedPaths: string[];
}

/** Resolve and validate an output directory (created if missing). */
export async function prepareOutDir(dir: string, policy: OutputPolicy): Promise<string> {
  if (dir.includes("\0")) throw new CliError("Output path contains a null byte", EXIT.USAGE);
  const abs = path.resolve(policy.cwd, dir);
  const rel = path.relative(policy.cwd, abs);
  if (!policy.allowOutsideCwd && (rel.startsWith("..") || path.isAbsolute(rel))) {
    throw new CliError(`Output directory "${dir}" is outside the current directory`, EXIT.OUTPUT, "Use a directory inside the project, or pass --allow-outside-cwd.");
  }
  if (existsSync(abs) && !statSync(abs).isDirectory()) throw new CliError(`Output path "${dir}" exists and is not a directory`, EXIT.OUTPUT);
  await fs.mkdir(abs, { recursive: true });
  return abs;
}

/** Resolve an output file path inside an output directory and check it is safe to write. */
export function outputFile(outDir: string, fileName: string, policy: OutputPolicy): string {
  if (fileName !== path.basename(fileName) || fileName.startsWith(".")) throw new CliError(`Unsafe output file name "${fileName}"`, EXIT.OUTPUT);
  const target = path.join(outDir, fileName);
  if (existsSync(target)) {
    const real = realpathSync(target);
    if (policy.protectedPaths.includes(real)) throw new CliError(`Refusing to overwrite the source file ${fileName}`, EXIT.OUTPUT, "Choose a different --out-dir.");
    if (!policy.force) throw new CliError(`Output file already exists: ${path.relative(policy.cwd, target) || target}`, EXIT.OUTPUT, "Pass --force to overwrite it, or choose another --out-dir.");
  }
  return target;
}

/** Writes records as JSON, JSONL or CSV, streaming to a temporary file that is renamed on success. */
export class RecordWriter {
  private readonly tmp: string;
  private readonly out;
  private count = 0;
  private opened = false;

  constructor(
    readonly target: string,
    private readonly format: DataFormat,
    private readonly options: { columns?: string[]; pretty?: boolean; jsonWrapKey?: string } = {},
  ) {
    this.tmp = path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.${Date.now()}.tmp`);
    this.out = createWriteStream(this.tmp, { flags: "wx", encoding: "utf8", mode: 0o644 });
  }

  private async write(s: string): Promise<void> {
    if (!this.out.write(s)) await once(this.out, "drain");
  }

  private async open(): Promise<void> {
    if (this.opened) return;
    this.opened = true;
    if (this.format === "csv") {
      if (!this.options.columns) throw new Error("CSV output needs columns");
      await this.write(csvHeader(this.options.columns));
    } else if (this.format === "json") await this.write("[");
  }

  async add(record: DataRecord): Promise<void> {
    await this.open();
    if (this.format === "jsonl") await this.write(JSON.stringify(record) + "\n");
    else if (this.format === "csv") await this.write(csvRow(record, this.options.columns!));
    else {
      const body = this.options.pretty === false ? JSON.stringify(record) : JSON.stringify(record, null, 2).replace(/\n/g, "\n  ");
      await this.write(`${this.count ? "," : ""}\n  ${body}`);
    }
    this.count++;
  }

  get written(): number {
    return this.count;
  }

  async close(): Promise<void> {
    await this.open();
    if (this.format === "json") await this.write(this.count ? "\n]\n" : "]\n");
    this.out.end();
    await once(this.out, "finish");
    await fs.rename(this.tmp, this.target);
  }

  async abort(): Promise<void> {
    this.out.destroy();
    await fs.rm(this.tmp, { force: true });
  }
}

/** Write a whole text file atomically. */
export async function writeTextFile(target: string, text: string): Promise<void> {
  const tmp = path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.${Date.now()}.tmp`);
  await fs.writeFile(tmp, text, { encoding: "utf8", flag: "wx", mode: 0o644 });
  await fs.rename(tmp, target);
}

export async function readJsonFile(cwd: string, file: string, what: string): Promise<unknown> {
  const p = path.resolve(cwd, file);
  if (!existsSync(p)) throw new CliError(`${what} file not found: ${file}`, EXIT.INPUT);
  const st = statSync(p);
  if (st.size > 10 * 1048576) throw new CliError(`${what} file is larger than 10 MB`, EXIT.INPUT);
  const text = await fs.readFile(p, "utf8");
  try {
    return JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch (e) {
    throw new CliError(`${what} file ${file} is not valid JSON: ${(e as Error).message.replace(/,?\s*".*"\s*is not valid JSON/s, "")}`, EXIT.CONFIG);
  }
}
