import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DataGhost, inferSchema, inspectDataset, toDataset, type InferredField } from "@workfonic/dataghost";

const company = JSON.parse(readFileSync(new URL("../../../examples/data/company.json", import.meta.url), "utf8"));
const field = (fields: InferredField[], path: string) => {
  const f = fields.find((x) => x.path === path);
  if (!f) throw new Error(`no field ${path}: ${fields.map((x) => x.path).join(", ")}`);
  return f;
};

describe("schema inference: types", () => {
  const records = [
    { id: 1, name: "Ana Silva", score: 9.5, active: true, born: "1990-04-01", seen: "2024-01-02T10:00:00Z", tags: ["a", "b"], meta: { level: 2 }, note: null },
    { id: 2, name: "Kai Weber", score: 7, active: false, born: "1985-12-31", seen: "2024-02-03T11:30:00Z", tags: [], meta: { level: 3 }, note: "x" },
    { id: 3, name: "Mei Tanaka", score: 8.25, active: true, born: "2000-07-15", seen: "2024-03-04T12:45:00Z", tags: ["c"], meta: { level: 1 } },
  ];
  const r = inferSchema(records);

  it("infers primitive types", () => {
    expect(field(r.fields, "id").type).toBe("integer");
    expect(field(r.fields, "score").type).toBe("number");
    expect(field(r.fields, "active").type).toBe("boolean");
    expect(field(r.fields, "born").type).toBe("date");
    expect(field(r.fields, "seen").type).toBe("timestamp");
  });

  it("infers nested objects and arrays", () => {
    expect(field(r.fields, "meta").type).toBe("object");
    expect(field(r.fields, "meta.level").type).toBe("integer");
    expect(field(r.fields, "tags").type).toBe("array");
    expect(field(r.fields, "tags").stats).toMatchObject({ minItems: 0, maxItems: 2 });
    expect(field(r.fields, "tags[]").type).toBe("string");
  });

  it("records nullability and optionality", () => {
    const note = field(r.fields, "note");
    expect(note.nullable).toBe(true);
    expect(note.optional).toBe(true);
    expect(note.presentRate).toBeCloseTo(2 / 3, 2);
    expect(field(r.fields, "id").nullable).toBe(false);
  });

  it("produces a usable generation schema", async () => {
    const ghost = new DataGhost({ seed: 1 });
    const out = await ghost.generate({ schema: r.schema, count: 50 });
    expect(out).toHaveLength(50);
    expect(typeof out[0]!.meta).toBe("object");
    expect(Array.isArray(out[0]!.tags)).toBe(true);
    for (const rec of out) expect(rec.born === undefined || /^\d{4}-\d{2}-\d{2}$/.test(rec.born as string)).toBe(true);
  });

  it("uses many records rather than the first one", () => {
    const rows = [{ v: 1 }, { v: "two" }, { v: "three" }, { v: "four" }];
    const f = field(inferSchema(rows).fields, "v");
    expect(f.type).toBe("string");
    expect(f.warnings.join(" ")).toMatch(/Mixed value types/);
  });

  it("treats integer + decimal as number, not mixed", () => {
    const f = field(inferSchema([{ v: 1 }, { v: 2.5 }]).fields, "v");
    expect(f.type).toBe("number");
    expect(f.warnings.join(" ")).not.toMatch(/Mixed/);
  });

  it("handles fields that are always null", () => {
    const f = field(inferSchema([{ v: null }, { v: null }]).fields, "v");
    expect(f.type).toBe("null");
    expect(f.warnings.join(" ")).toMatch(/always null/);
  });
});

describe("schema inference: semantic types", () => {
  const r = inspectDataset(toDataset(company));
  const emp = r.collections.find((c) => c.name === "employees")!;
  const dept = r.collections.find((c) => c.name === "departments")!;

  it("detects personal, professional and technical fields", () => {
    const expected: Record<string, string> = {
      employeeId: "employeeId",
      firstName: "firstName",
      lastName: "lastName",
      email: "email",
      phone: "phone",
      jobTitle: "jobTitle",
      salary: "salary",
      joiningDate: "joiningDate",
      status: "status",
      "address.street": "street",
      "address.city": "city",
      "address.postalCode": "postalCode",
    };
    for (const [path, semantic] of Object.entries(expected)) expect(field(emp.fields, path).semanticType, path).toBe(semantic);
  });

  it("uses collection context for generic names", () => {
    expect(field(dept.fields, "name").semanticType).toBe("department");
  });

  it("learns identifier formats", () => {
    expect(field(emp.fields, "employeeId").suggestedGenerator).toEqual({ type: "employeeId", options: { prefix: "EMP-", pad: 3 } });
    expect(field(dept.fields, "departmentId").suggestedGenerator).toEqual({ type: "sequence", options: { prefix: "DEPT-", pad: 2 } });
  });

  it("learns enums with weights for non-sensitive fields", () => {
    const s = field(emp.fields, "status").suggestedGenerator!;
    expect(s.type).toBe("enum");
    expect(s.options.values).toEqual(expect.arrayContaining(["active", "probation", "on_leave"]));
  });

  it("records confidence and privacy classification", () => {
    const email = field(emp.fields, "email");
    expect(email.confidence).toBeGreaterThan(0.9);
    expect(email.privacy?.category).toBe("email");
    expect(field(emp.fields, "salary").privacy).toBeUndefined();
  });

  it("never exposes sensitive source values in examples", () => {
    const text = JSON.stringify(r);
    for (const v of ["ava.okafor@example.com", "Okafor", "+1 202-555-0101", "12 Maple Avenue"]) expect(text).not.toContain(v);
    expect(field(emp.fields, "email").example).toBe("<email>");
  });

  it("detects relationships including self references", () => {
    expect(r.relationships).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ from: "employees.departmentId", to: "departments.departmentId" }),
        expect.objectContaining({ from: "employees.managerId", to: "employees.employeeId" }),
      ]),
    );
  });

  it("reports totals and privacy warnings", () => {
    expect(r.totals.collections).toBe(2);
    expect(r.totals.records).toBe(12);
    expect(r.privacy.fields.length).toBeGreaterThan(4);
    expect(r.privacy.limitations.join(" ")).toMatch(/do not guarantee anonymisation/);
  });
});

describe("schema inference: regressions", () => {
  it("keeps zero-padded postal codes and phone numbers as strings", () => {
    const r = inferSchema([
      { zip: "02134", phone: "0207 946 0123" },
      { zip: "00501", phone: "0161 496 0000" },
      { zip: "10001", phone: "0113 496 0999" },
    ]);
    expect(field(r.fields, "zip").type).toBe("string");
    expect(field(r.fields, "phone").type).toBe("string");
  });

  it("does not treat organisation names as person names", () => {
    const r = inspectDataset({ companies: [{ name: "Acme Labs" }, { name: "Northwind Systems" }, { name: "Cobalt Freight" }] });
    const f = field(r.collections[0]!.fields, "name");
    expect(f.semanticType).toBe("company");
    expect(f.privacy?.category).not.toBe("personName");
  });

  it("does not classify a status enum as sensitive", () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({ status: ["active", "inactive"][i % 2] }));
    expect(field(inferSchema(rows).fields, "status").privacy).toBeUndefined();
  });

  it("does not learn enums for sensitive fields", () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({ email: `user${i % 3}@example.com` }));
    const f = field(inferSchema(rows).fields, "email");
    expect(f.suggestedGenerator!.type).toBe("email");
    expect(JSON.stringify(f)).not.toContain("user1@example.com");
  });

  it("replaces secret fields with the secret generator", () => {
    const f = field(inferSchema([{ password: "hunter2" }, { password: "letmein" }]).fields, "password");
    expect(f.suggestedGenerator!.type).toBe("secret");
    expect(f.privacy?.level).toBe("secret");
  });

  it("turns unique integer ids into sequences", () => {
    const f = field(inferSchema([{ id: 10 }, { id: 11 }, { id: 12 }]).fields, "id");
    expect(f.suggestedGenerator).toEqual({ type: "sequence", options: { start: 10 } });
  });

  it("understands MongoDB extended JSON", async () => {
    const docs = [
      { _id: { $oid: "65a1b2c3d4e5f60718293a4b" }, createdAt: { $date: "2024-01-01T00:00:00Z" }, n: 1 },
      { _id: { $oid: "65a1b2c3d4e5f60718293a4c" }, createdAt: { $date: "2024-02-01T00:00:00Z" }, n: 2 },
    ];
    const r = inferSchema(docs);
    expect(field(r.fields, "_id").semanticType).toBe("objectId");
    expect(field(r.fields, "createdAt").type).toBe("timestamp");
    const out = await new DataGhost({ seed: 1 }).generate({ schema: r.schema, count: 3 });
    expect((out[0]!._id as { $oid: string }).$oid).toMatch(/^[0-9a-f]{24}$/);
    expect((out[0]!.createdAt as { $date: string }).$date).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe("overrides", () => {
  it("applies manual overrides to the schema and marks fields", () => {
    const r = inferSchema([{ code: "a1", nested: { v: 1 } }, { code: "b2", nested: { v: 2 } }], {
      overrides: { code: "uuid", "nested.v": { type: "integer", min: 100, max: 200 } },
    });
    expect(r.schema.code).toBe("uuid");
    expect(field(r.fields, "code").overridden).toBe(true);
    expect(field(r.fields, "code").suggestedGenerator!.type).toBe("uuid");
    expect(((r.schema.nested as { fields: Record<string, unknown> }).fields.v)).toEqual({ type: "integer", min: 100, max: 200 });
  });

  it("warns about override paths that do not exist", () => {
    const r = inferSchema([{ a: 1 }], { overrides: { "missing.deep": "uuid" } });
    expect(r.warnings.join(" ")).toMatch(/did not match/);
  });

  it("supports collection-scoped overrides in datasets", () => {
    const r = inspectDataset(toDataset(company), { overrides: { employees: { salary: { type: "integer", min: 1, max: 2 } } } });
    const emp = r.collections.find((c) => c.name === "employees")!;
    expect(emp.schema.salary).toEqual({ type: "integer", min: 1, max: 2 });
  });
});
