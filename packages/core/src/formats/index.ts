import { ParseError } from "../errors.js";
import type { DataRecord, Dataset } from "../engine.js";
import { parseCsv, toCsv, type CsvWriteOptions } from "./csv.js";
import { parseJson, parseJsonl, toJson, toJsonl } from "./json.js";

export * from "./csv.js";
export * from "./json.js";

export type DataFormat = "json" | "jsonl" | "csv";
export const FORMATS: readonly DataFormat[] = ["json", "jsonl", "csv"];

/** Detect a format from a file name, falling back to sniffing the content. */
export function detectFormat(fileName: string | undefined, text?: string): DataFormat {
  const ext = fileName?.toLowerCase().match(/\.(json|jsonl|ndjson|csv|tsv)$/)?.[1];
  if (ext === "json") return "json";
  if (ext === "jsonl" || ext === "ndjson") return "jsonl";
  if (ext === "csv" || ext === "tsv") return "csv";
  const t = (text ?? "").trimStart();
  if (t.startsWith("[")) return "json";
  if (t.startsWith("{")) {
    const firstLine = t.split(/\r?\n/, 1)[0]!.trim();
    try {
      JSON.parse(firstLine);
      return t.split(/\r?\n/).filter((l) => l.trim()).length > 1 ? "jsonl" : "json";
    } catch {
      return "json";
    }
  }
  return "csv";
}

/** Parse text in a given format into a raw value (records array or dataset object). */
export function parseText(text: string, format: DataFormat, maxBytes?: number): unknown {
  switch (format) {
    case "json":
      return parseJson(text, maxBytes);
    case "jsonl":
      return parseJsonl(text, maxBytes);
    case "csv":
      return parseCsv(text, { maxBytes });
  }
}

function isRecord(v: unknown): v is DataRecord {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Interpret parsed input as a dataset:
 * - an array of objects is one collection,
 * - an object whose values are all arrays of objects is several collections,
 * - a single object is one collection with one record.
 */
export function toDataset(value: unknown, defaultName = "records"): Dataset {
  if (Array.isArray(value)) {
    const bad = value.findIndex((v) => !isRecord(v));
    if (bad >= 0) throw new ParseError(`Expected an array of objects, but element ${bad} is ${value[bad] === null ? "null" : Array.isArray(value[bad]) ? "an array" : typeof value[bad]}`);
    return { [defaultName]: value as DataRecord[] };
  }
  if (isRecord(value)) {
    const entries = Object.entries(value);
    const allCollections = entries.length > 0 && entries.every(([, v]) => Array.isArray(v) && v.length > 0 && v.every(isRecord));
    if (allCollections) {
      const out: Dataset = {};
      for (const [k, v] of entries) out[k] = v as DataRecord[];
      return out;
    }
    return { [defaultName]: [value] };
  }
  throw new ParseError("Input must be a JSON object, an array of objects, JSON Lines or CSV with a header row");
}

/** Safe collection name for use in file names. */
export function collectionFileName(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9_-]/g, "_").replace(/^[-_.]+/, "").slice(0, 64);
  return cleaned || "collection";
}

/** Serialise records (or a dataset for JSON) to text. */
export function serialize(data: DataRecord[] | Dataset, format: DataFormat, options: { pretty?: boolean; csv?: CsvWriteOptions } = {}): string {
  if (format === "json") return toJson(data, options.pretty !== false);
  if (!Array.isArray(data)) throw new ParseError(`${format.toUpperCase()} output holds one collection; serialise each collection separately`);
  return format === "jsonl" ? toJsonl(data) : toCsv(data, options.csv);
}
