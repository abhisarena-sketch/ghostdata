import { describe, expect, it } from "vitest";
import {
  coerceCell,
  collectionFileName,
  CsvStreamParser,
  DataGhost,
  detectFormat,
  flattenRecord,
  JsonArrayStreamParser,
  LimitError,
  normalizeSchema,
  defaultRegistry,
  columnsFromSchema,
  parseCsv,
  parseJson,
  parseJsonl,
  ParseError,
  toCsv,
  toDataset,
  toJsonl,
  unflattenRecord,
  validateRecords,
} from "@workfonic/dataghost";

describe("JSON", () => {
  it("parses with line information on errors", () => {
    expect(parseJson('{"a":1}')).toEqual({ a: 1 });
    expect(() => parseJson('{\n"a": 1,\n}')).toThrow(ParseError);
  });

  it("enforces size limits", () => {
    expect(() => parseJson("[1,2,3]", 3)).toThrow(LimitError);
  });

  it("strips a BOM", () => {
    expect(parseJson("﻿[1]")).toEqual([1]);
  });
});

describe("JSONL", () => {
  it("parses lines and skips blanks", () => {
    expect(parseJsonl('{"a":1}\n\n{"a":2}\r\n')).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it("reports the failing line", () => {
    try {
      parseJsonl('{"a":1}\n{bad}\n');
      expect.unreachable();
    } catch (e) {
      expect((e as ParseError).line).toBe(2);
    }
  });

  it("serialises one record per line", () => {
    expect(toJsonl([{ a: 1 }, { b: [2] }])).toBe('{"a":1}\n{"b":[2]}\n');
  });
});

describe("streaming JSON arrays", () => {
  it("splits elements across arbitrary chunk boundaries", () => {
    const records = Array.from({ length: 50 }, (_, i) => ({ i, s: `q"uo,te}]{[ ${i}`, n: { a: [i, { b: i }] } }));
    const text = JSON.stringify(records, null, 2);
    for (const size of [1, 7, 64, 1000]) {
      const p = new JsonArrayStreamParser();
      const out: unknown[] = [];
      for (let i = 0; i < text.length; i += size) out.push(...p.push(text.slice(i, i + size)));
      p.end();
      expect(out).toEqual(records);
    }
  });

  it("handles scalars and empty arrays", () => {
    const p = new JsonArrayStreamParser();
    expect(p.push("[1, 2,3]")).toEqual([1, 2, 3]);
    const e = new JsonArrayStreamParser();
    expect(e.push("[ ]")).toEqual([]);
    e.end();
  });

  it("rejects non-arrays and truncated input", () => {
    expect(() => new JsonArrayStreamParser().push('{"a":1}')).toThrow(/top-level array/);
    const p = new JsonArrayStreamParser();
    p.push('[{"a":1}, {"a":');
    expect(() => p.end()).toThrow(/not closed/);
  });
});

describe("CSV", () => {
  it("parses with typing, nulls and nested columns", () => {
    const csv = 'id,name,zip,active,score,address.city,address.street,tags\n1,"Silva, Ana",02134,true,9.5,Springfield,12 Maple Ave,"[""a"",""b""]"\n2,Kai,,false,,Ashford,,[]\n';
    const rows = parseCsv(csv);
    expect(rows[0]).toEqual({ id: 1, name: "Silva, Ana", zip: "02134", active: true, score: 9.5, address: { city: "Springfield", street: "12 Maple Ave" }, tags: ["a", "b"] });
    expect(rows[1]).toMatchObject({ zip: null, score: null, address: { city: "Ashford", street: null }, tags: [] });
  });

  it("keeps long digit strings and leading zeros as strings", () => {
    expect(coerceCell("00123")).toBe("00123");
    expect(coerceCell("4111111111111111")).toBe("4111111111111111");
    expect(coerceCell("-12.5")).toBe(-12.5);
    expect(coerceCell("1e3")).toBe(1000);
  });

  it("rejects duplicate headers and malformed quoting", () => {
    expect(() => parseCsv("a,a\n1,2\n")).toThrow(/duplicate column/);
    expect(() => parseCsv('a,b\n"1,2\n')).toThrow(ParseError);
  });

  it("drops prototype-polluting columns", () => {
    const rows = parseCsv("__proto__.x,a.constructor,ok\n1,2,3\n");
    expect(rows[0]).toEqual({ ok: 3 });
    expect(({} as Record<string, unknown>).x).toBeUndefined();
  });

  it("round-trips nested records", () => {
    const records = [{ a: 1, b: { c: "x,y", d: null }, e: [1, 2], f: "line\nbreak" }];
    expect(parseCsv(toCsv(records))).toEqual(records);
  });

  it("guards against spreadsheet formula injection", () => {
    const csv = toCsv([{ a: "=HYPERLINK(1)", b: "+SUM(A1)", c: "+1 202-555-0101", d: "-5", e: "@x" }]);
    expect(csv.split("\n")[1]).toBe("'=HYPERLINK(1),'+SUM(A1),+1 202-555-0101,-5,'@x");
    expect(toCsv([{ a: "=1" }], { formulaGuard: false })).toContain("\n=1\n");
  });

  it("streams rows across chunk boundaries including quoted newlines", () => {
    const records = Array.from({ length: 30 }, (_, i) => ({ id: i, note: i % 3 ? `plain ${i}` : `multi\nline, "quoted" ${i}`, nested: { v: i } }));
    const text = toCsv(records);
    for (const size of [1, 5, 33, 4096]) {
      const p = new CsvStreamParser();
      const out: unknown[] = [];
      for (let i = 0; i < text.length; i += size) out.push(...p.push(text.slice(i, i + size)));
      out.push(...p.end());
      expect(out).toEqual(records);
    }
  });

  it("derives columns from a schema", () => {
    const s = normalizeSchema({ a: "email", b: { c: "city", d: { e: "uuid" } }, t: { type: "array", items: "email" } }, { registry: defaultRegistry });
    expect(columnsFromSchema(s)).toEqual(["a", "b.c", "b.d.e", "t"]);
  });

  it("flattens and unflattens", () => {
    expect(flattenRecord({ a: { b: { c: 1 } }, d: [1], e: {} })).toEqual({ "a.b.c": 1, d: [1], e: {} });
    expect(unflattenRecord({ "a.b": 1, "a.c": 2, x: 3 })).toEqual({ a: { b: 1, c: 2 }, x: 3 });
  });
});

describe("format detection and datasets", () => {
  it("detects formats", () => {
    expect(detectFormat("x.json")).toBe("json");
    expect(detectFormat("x.ndjson")).toBe("jsonl");
    expect(detectFormat("x.CSV")).toBe("csv");
    expect(detectFormat(undefined, '{"a":1}\n{"a":2}')).toBe("jsonl");
    expect(detectFormat(undefined, "[{}]")).toBe("json");
    expect(detectFormat(undefined, "a,b\n1,2")).toBe("csv");
  });

  it("interprets dataset shapes", () => {
    expect(Object.keys(toDataset([{ a: 1 }]))).toEqual(["records"]);
    expect(Object.keys(toDataset({ users: [{ a: 1 }], orders: [{ b: 2 }] }))).toEqual(["users", "orders"]);
    expect(toDataset({ a: 1, b: [1] })).toEqual({ records: [{ a: 1, b: [1] }] });
    expect(() => toDataset([1, 2])).toThrow(/array of objects/);
    expect(() => toDataset("x")).toThrow(ParseError);
  });

  it("sanitises collection file names", () => {
    expect(collectionFileName("../../etc/passwd")).toBe("etc_passwd");
    expect(collectionFileName("..")).toBe("collection");
    expect(collectionFileName("users")).toBe("users");
  });

  it("exports through the SDK", async () => {
    const ghost = new DataGhost({ seed: 1 });
    const recs = await ghost.generate({ schema: { a: "email", n: { b: "integer" } }, count: 3 });
    expect(ghost.export(recs, "jsonl").trim().split("\n")).toHaveLength(3);
    expect(ghost.export(recs, "csv").split("\n")[0]).toBe("a,n.b");
    expect(JSON.parse(ghost.export({ x: recs }, "json"))).toEqual({ x: recs });
    expect(() => ghost.export({ x: recs }, "csv")).toThrow(/one collection/);
    expect(ghost.parse(ghost.export(recs, "csv"), "csv").records).toEqual(recs);
  });
});

describe("validation", () => {
  const ghost = new DataGhost({ seed: 1 });
  const schema = { id: { type: "sequence" }, email: "email", age: { type: "integer", min: 18, max: 65 }, status: { type: "enum", values: ["a", "b"] }, at: "timestamp", d: "date", nick: { type: "firstName", nullable: true }, opt: { type: "city", optional: true }, tags: { type: "array", items: "email", minItems: 1, maxItems: 2 }, nested: { flag: "boolean" } };

  it("accepts generated output", async () => {
    const recs = await ghost.generate({ schema, count: 200 });
    const r = ghost.validate(recs, schema);
    expect(r.errors).toEqual([]);
    expect(r.valid).toBe(true);
  });

  it("reports type, range, enum, null, missing and array errors", () => {
    const r = ghost.validate(
      [{ id: 1, email: 5, age: 99, status: "c", at: "yesterday", d: "2024-13-45", nick: null, tags: [], nested: { flag: "yes" }, extra: 1 }, { id: 2, email: null }],
      schema,
    );
    const msgs = r.errors.map((e) => `${e.recordIndex}:${e.path}:${e.message}`);
    expect(msgs).toEqual(
      expect.arrayContaining([
        "0:email:expected string, got number",
        "0:age:value 99 is above max 65",
        "0:status:value is not one of the 2 allowed values",
        "0:at:expected an ISO 8601 timestamp",
        "0:d:expected a YYYY-MM-DD date",
        "0:tags:array length 0 outside 1..2",
        "0:nested.flag:expected boolean, got string",
        "1:email:null is not allowed (field is not nullable)",
        "1:age:required field is missing",
      ]),
    );
    expect(r.warnings.map((w) => w.path)).toContain("extra");
    expect(msgs.some((m) => m.startsWith("0:nick"))).toBe(false);
    expect(msgs.some((m) => m.includes(":opt:"))).toBe(false);
  });

  it("detects duplicates in unique fields", () => {
    const s = normalizeSchema({ k: { type: "uuid", unique: true } }, { registry: defaultRegistry });
    expect(validateRecords([{ k: "a" }, { k: "a" }], s).errors[0]!.message).toMatch(/duplicate/);
  });

  it("validates datasets with integrity and safety scanning", async () => {
    const { data } = await ghost.generateDataset({
      collections: { d: { count: 3, schema: { id: { type: "sequence" } } }, e: { count: 10, schema: { email: "email", dId: "integer" } } },
      relationships: [{ from: "e.dId", to: "d.id" }],
    });
    const ok = ghost.validateDataset(data, { relationships: [{ from: "e.dId", to: "d.id" }], schemas: { e: { email: "email", dId: "integer" } } });
    expect(ok.valid).toBe(true);
    data.e![0]!.dId = 999;
    data.e![1]!.email = "real.person@gmail.com";
    const bad = ghost.validateDataset(data, { relationships: [{ from: "e.dId", to: "d.id" }] });
    expect(bad.valid).toBe(false);
    expect(bad.integrity!.issues[0]!.kind).toBe("dangling-reference");
    expect(bad.safety[0]!.location).toBe("e[1].email");
  });
});
