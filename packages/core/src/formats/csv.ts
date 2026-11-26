import Papa from "papaparse";
import { LimitError, ParseError } from "../errors.js";
import { DEFAULT_MAX_INPUT_BYTES } from "./json.js";
import type { NormalizedField } from "../schema.js";

export interface CsvParseOptions {
  /** Convert "a.b" columns into nested objects (default true). */
  unflatten?: boolean;
  /** Convert numbers, booleans and empty cells (default true). */
  coerce?: boolean;
  delimiter?: string;
  maxBytes?: number;
}

const NUMBER = /^-?(0|[1-9]\d{0,14})(\.\d+)?([eE][+-]?\d+)?$/;
const FORBIDDEN = new Set(["__proto__", "constructor", "prototype"]);

/** Coerce a CSV cell: "" -> null, "true"/"false" -> boolean, plain numbers -> number. Leading zeros stay strings. */
export function coerceCell(value: string): unknown {
  if (value === "") return null;
  if (value === "true" || value === "TRUE") return true;
  if (value === "false" || value === "FALSE") return false;
  if (NUMBER.test(value)) {
    const n = Number(value);
    if (Number.isFinite(n) && (Number.isInteger(n) ? Number.isSafeInteger(n) : true)) return n;
  }
  const first = value[0];
  if ((first === "[" || first === "{") && value.length < 1_000_000) {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value;
}

/** Turn {"a.b": 1} into {a: {b: 1}}. Keys that would collide with a scalar are kept flat. */
export function unflattenRecord(flat: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(flat)) {
    const parts = key.split(".");
    if (parts.some((p) => FORBIDDEN.has(p))) continue;
    if (parts.some((p) => p === "")) {
      out[key] = value;
      continue;
    }
    let node: Record<string, unknown> = out;
    let ok = true;
    for (let i = 0; i < parts.length - 1; i++) {
      const p = parts[i]!;
      if (node[p] === undefined) node[p] = {};
      else if (typeof node[p] !== "object" || node[p] === null || Array.isArray(node[p])) {
        ok = false;
        break;
      }
      node = node[p] as Record<string, unknown>;
    }
    if (ok) node[parts[parts.length - 1]!] = value;
    else out[key] = value;
  }
  return out;
}

/** Flatten nested objects into dot-separated keys. Arrays are kept as values (serialised as JSON in CSV). */
export function flattenRecord(record: Record<string, unknown>, prefix = "", out: Record<string, unknown> = {}): Record<string, unknown> {
  for (const [k, v] of Object.entries(record)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length > 0 && !isExtendedJson(v as Record<string, unknown>)) {
      flattenRecord(v as Record<string, unknown>, key, out);
    } else out[key] = v;
  }
  return out;
}

function isExtendedJson(v: Record<string, unknown>): boolean {
  const keys = Object.keys(v);
  return keys.length === 1 && keys[0]!.startsWith("$");
}

function rowsToRecords(rows: Record<string, string>[], o: CsvParseOptions): Record<string, unknown>[] {
  const coerce = o.coerce !== false;
  return rows.map((row) => {
    const flat: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row)) {
      if (k.split(".").some((p) => FORBIDDEN.has(p))) continue;
      flat[k] = coerce ? coerceCell(v ?? "") : v;
    }
    return o.unflatten === false ? flat : unflattenRecord(flat);
  });
}

/** Parse CSV text (with a header row) into records. */
export function parseCsv(text: string, options: CsvParseOptions = {}): Record<string, unknown>[] {
  const max = options.maxBytes ?? DEFAULT_MAX_INPUT_BYTES;
  if (text.length > max) throw new LimitError(`CSV input is larger than the ${Math.round(max / 1048576)} MB limit`);
  const res = Papa.parse<Record<string, string>>(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text, {
    header: true,
    skipEmptyLines: "greedy",
    dynamicTyping: false,
    delimiter: options.delimiter ?? "",
  });
  const fatal = res.errors.filter((e) => e.type !== "Delimiter" || res.data.length === 0);
  if (fatal.length) {
    const e = fatal[0]!;
    throw new ParseError(`Invalid CSV${e.row !== undefined ? ` at row ${e.row + 2}` : ""}: ${e.message}`, e.row !== undefined ? e.row + 2 : undefined);
  }
  if (!res.meta.fields || res.meta.fields.length === 0) throw new ParseError("CSV input has no header row");
  const renamed = (res.meta as { renamedHeaders?: Record<string, string> }).renamedHeaders;
  const dup = renamed && Object.keys(renamed).length ? Object.values(renamed)[0] : res.meta.fields.find((f, i) => res.meta.fields!.indexOf(f) !== i);
  if (dup) throw new ParseError(`CSV header has a duplicate column "${dup}"`);
  return rowsToRecords(res.data, options);
}

/**
 * Streaming CSV parsing: feed text chunks; complete rows are returned as
 * records. Header handling and coercion match parseCsv().
 */
export class CsvStreamParser {
  private header: string[] | null = null;
  private pending = "";
  private inQuotes = false;
  private lineNo = 0;

  constructor(private readonly options: CsvParseOptions = {}) {}

  push(chunk: string): Record<string, unknown>[] {
    const text = this.pending + chunk;
    // Find the last newline that is outside quotes.
    let cut = -1;
    let q = this.inQuotes;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (c === '"') q = !q;
      else if (c === "\n" && !q) cut = i;
    }
    if (cut < 0) {
      this.pending = text;
      if (this.pending.length > 16 * 1024 * 1024) throw new LimitError("A CSV row exceeds 16 MB");
      return [];
    }
    const complete = text.slice(0, cut + 1);
    this.pending = text.slice(cut + 1);
    return this.parseBlock(complete);
  }

  end(): Record<string, unknown>[] {
    const rest = this.pending;
    this.pending = "";
    if (!rest.trim()) {
      if (!this.header) throw new ParseError("CSV input has no header row");
      return [];
    }
    return this.parseBlock(rest);
  }

  private parseBlock(block: string): Record<string, unknown>[] {
    const res = Papa.parse<string[]>(this.lineNo === 0 && block.charCodeAt(0) === 0xfeff ? block.slice(1) : block, {
      header: false,
      skipEmptyLines: "greedy",
      delimiter: this.options.delimiter ?? ",",
    });
    if (res.errors.length) {
      const e = res.errors[0]!;
      throw new ParseError(`Invalid CSV near row ${this.lineNo + (e.row ?? 0) + 1}: ${e.message}`);
    }
    const rows = res.data;
    if (!this.header) {
      const h = rows.shift();
      if (!h) return [];
      this.header = h;
      const dup = h.find((f, i) => h.indexOf(f) !== i);
      if (dup) throw new ParseError(`CSV header has a duplicate column "${dup}"`);
      this.lineNo++;
    }
    const header = this.header;
    const objs = rows.map((r, i) => {
      if (r.length !== header.length) throw new ParseError(`CSV row ${this.lineNo + i + 1} has ${r.length} columns, expected ${header.length}`, this.lineNo + i + 1);
      const o: Record<string, string> = {};
      header.forEach((h, j) => (o[h] = r[j] ?? ""));
      return o;
    });
    this.lineNo += rows.length;
    return rowsToRecords(objs, this.options);
  }
}

export interface CsvWriteOptions {
  columns?: string[];
  delimiter?: string;
  /** Prefix cells that spreadsheets would evaluate as formulas with "'" (default true). */
  formulaGuard?: boolean;
}

const FORMULA = /^[=@\t\r]|^[+-][^\d\s.]/;

function cell(v: unknown, guard: boolean): string {
  if (v === null || v === undefined) return "";
  let s = typeof v === "object" ? JSON.stringify(v) : String(v);
  if (guard && FORMULA.test(s)) s = `'${s}`;
  return s;
}

function escapeCell(s: string, delimiter: string): string {
  if (s.includes('"') || s.includes(delimiter) || s.includes("\n") || s.includes("\r")) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** Column names for a schema, flattening nested objects with dots. */
export function columnsFromSchema(field: NormalizedField, prefix = ""): string[] {
  if (field.kind !== "object" || field.wrap) return [prefix];
  const out: string[] = [];
  for (const [k, f] of field.fields) out.push(...columnsFromSchema(f, prefix ? `${prefix}.${k}` : k));
  return out;
}

/** Union of flattened keys across records, in first-seen order. */
export function columnsFromRecords(records: Iterable<Record<string, unknown>>): string[] {
  const seen = new Set<string>();
  for (const r of records) for (const k of Object.keys(flattenRecord(r))) seen.add(k);
  return Array.from(seen);
}

export function csvHeader(columns: string[], delimiter = ","): string {
  return columns.map((c) => escapeCell(c, delimiter)).join(delimiter) + "\n";
}

export function csvRow(record: Record<string, unknown>, columns: string[], options: CsvWriteOptions = {}): string {
  const d = options.delimiter ?? ",";
  const flat = flattenRecord(record);
  return columns.map((c) => escapeCell(cell(flat[c], options.formulaGuard !== false), d)).join(d) + "\n";
}

export function toCsv(records: Record<string, unknown>[], options: CsvWriteOptions = {}): string {
  const columns = options.columns ?? columnsFromRecords(records);
  let s = csvHeader(columns, options.delimiter);
  for (const r of records) s += csvRow(r, columns, options);
  return s;
}
