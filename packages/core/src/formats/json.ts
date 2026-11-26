import { LimitError, ParseError } from "../errors.js";

export const DEFAULT_MAX_INPUT_BYTES = 100 * 1024 * 1024;
const MAX_LINE_BYTES = 16 * 1024 * 1024;

/**
 * Remove any quoted source snippet from a JSON.parse error message, so that
 * error output never echoes dataset contents.
 */
export function sanitizeJsonError(message: string): string {
  return message
    .replace(/^JSON\.parse: /, "")
    .replace(/,?\s*".*"\s*is not valid JSON/s, "")
    .replace(/token '.{1,4}'/g, "token")
    .replace(/Unexpected token .{1,4} in JSON/g, "Unexpected token in JSON")
    .slice(0, 200);
}

function stripBom(s: string): string {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

/** Parse a JSON document with a size limit and a helpful error position. */
export function parseJson(text: string, maxBytes = DEFAULT_MAX_INPUT_BYTES): unknown {
  if (text.length > maxBytes) throw new LimitError(`JSON input is larger than the ${Math.round(maxBytes / 1048576)} MB limit`);
  try {
    return JSON.parse(stripBom(text));
  } catch (e) {
    const msg = (e as Error).message;
    const m = /position (\d+)/.exec(msg);
    let line: number | undefined;
    if (m) line = stripBom(text).slice(0, Number(m[1])).split("\n").length;
    throw new ParseError(`Invalid JSON${line ? ` near line ${line}` : ""}: ${sanitizeJsonError(msg)}`, line);
  }
}

/** Parse JSON Lines: one JSON value per non-empty line. */
export function parseJsonl(text: string, maxBytes = DEFAULT_MAX_INPUT_BYTES): unknown[] {
  if (text.length > maxBytes) throw new LimitError(`JSONL input is larger than the ${Math.round(maxBytes / 1048576)} MB limit`);
  const out: unknown[] = [];
  const lines = stripBom(text).split(/\r?\n/);
  lines.forEach((line, i) => {
    const v = parseJsonlLine(line, i + 1);
    if (v !== undefined) out.push(v);
  });
  return out;
}

/** Parse one JSONL line (1-based line number for errors). Returns undefined for blank lines. */
export function parseJsonlLine(line: string, lineNumber: number): unknown {
  const t = line.trim();
  if (!t) return undefined;
  if (t.length > MAX_LINE_BYTES) throw new LimitError(`Line ${lineNumber} is longer than ${MAX_LINE_BYTES / 1048576} MB`);
  try {
    return JSON.parse(lineNumber === 1 ? stripBom(t) : t);
  } catch (e) {
    throw new ParseError(`Invalid JSON on line ${lineNumber}: ${sanitizeJsonError((e as Error).message)}`, lineNumber);
  }
}

/**
 * Incrementally splits a top-level JSON array into element texts, so very
 * large JSON array files can be processed without loading them fully.
 * Feed chunks with push(); complete elements are returned as parsed values.
 */
export class JsonArrayStreamParser {
  private buf = "";
  private started = false;
  private finished = false;
  private depth = 0;
  private inString = false;
  private escape = false;
  private elementStart = -1;
  private scanPos = 0;
  private readonly maxElementBytes: number;

  constructor(options: { maxElementBytes?: number } = {}) {
    this.maxElementBytes = options.maxElementBytes ?? MAX_LINE_BYTES;
  }

  push(chunk: string): unknown[] {
    const out: unknown[] = [];
    this.buf += chunk;
    let i = this.scanPos;
    const s = this.buf;
    if (!this.started) {
      while (i < s.length && (/\s/.test(s[i]!) || s.charCodeAt(i) === 0xfeff)) i++;
      if (i >= s.length) {
        this.scanPos = i;
        return out;
      }
      if (s[i] !== "[") throw new ParseError("Streaming JSON input must be a top-level array");
      this.started = true;
      i++;
    }
    for (; i < s.length; i++) {
      const c = s[i]!;
      if (this.finished) {
        if (!/\s/.test(c)) throw new ParseError("Unexpected content after the end of the JSON array");
        continue;
      }
      if (this.inString) {
        if (this.escape) this.escape = false;
        else if (c === "\\") this.escape = true;
        else if (c === '"') this.inString = false;
        continue;
      }
      if (this.elementStart < 0) {
        if (/\s/.test(c) || c === ",") continue;
        if (c === "]") {
          this.finished = true;
          continue;
        }
        this.elementStart = i;
      }
      if (c === '"') this.inString = true;
      else if (c === "{" || c === "[") this.depth++;
      else if (c === "}" || c === "]") {
        if (this.depth === 0) {
          // End of the outer array right after a scalar element.
          this.emit(s.slice(this.elementStart, i), out);
          this.elementStart = -1;
          this.finished = true;
          continue;
        }
        this.depth--;
        if (this.depth === 0) {
          this.emit(s.slice(this.elementStart, i + 1), out);
          this.elementStart = -1;
        }
      } else if (c === "," && this.depth === 0) {
        this.emit(s.slice(this.elementStart, i), out);
        this.elementStart = -1;
      }
    }
    // Drop consumed text to keep memory bounded.
    const keepFrom = this.elementStart >= 0 ? this.elementStart : s.length;
    if (keepFrom > 0) {
      this.buf = s.slice(keepFrom);
      if (this.elementStart >= 0) this.elementStart -= keepFrom;
      i -= keepFrom;
    }
    this.scanPos = i;
    if (this.elementStart >= 0 && this.buf.length > this.maxElementBytes) throw new LimitError(`A JSON array element exceeds ${Math.round(this.maxElementBytes / 1048576)} MB`);
    return out;
  }

  end(): void {
    if (!this.started) throw new ParseError("Empty JSON input");
    if (!this.finished) throw new ParseError("Unexpected end of JSON input: the array is not closed");
  }

  private emit(text: string, out: unknown[]) {
    const t = text.trim();
    if (!t) return;
    try {
      out.push(JSON.parse(t));
    } catch (e) {
      throw new ParseError(`Invalid JSON array element: ${sanitizeJsonError((e as Error).message)}`);
    }
  }
}

export function toJson(value: unknown, pretty = true): string {
  return JSON.stringify(value, null, pretty ? 2 : undefined) + "\n";
}

export function toJsonl(records: Iterable<unknown>): string {
  let s = "";
  for (const r of records) s += JSON.stringify(r) + "\n";
  return s;
}
