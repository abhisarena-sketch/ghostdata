import { describe, expect, it } from "vitest";
import { CircularDependencyError } from "@workfonic/dataghost-relationships";
import { ConfigError, DataGhost, GenerationError, InvalidSchemaError, validateIntegrity, type SchemaInput } from "@workfonic/dataghost";

const schema: SchemaInput = {
  id: "uuid",
  name: "fullName",
  email: "email",
  age: { type: "integer", min: 18, max: 65 },
  address: { street: "street", city: "city", postalCode: { type: "postalCode", country: "US" } },
  tags: { type: "array", items: { type: "enum", values: ["a", "b", "c"] }, minItems: 1, maxItems: 3 },
  nickname: { type: "firstName", nullable: 0.5 },
  middleName: { type: "firstName", optional: 0.5 },
};

describe("generate", () => {
  it("matches the README example", async () => {
    const ghost = new DataGhost({ seed: 12345 });
    const result = await ghost.generate({ schema: { name: "string", email: "email", age: { type: "number", min: 18, max: 65 } }, count: 100 });
    expect(result).toHaveLength(100);
    for (const r of result) {
      expect(typeof r.name).toBe("string");
      expect(r.email).toMatch(/@/);
      expect(r.age as number).toBeGreaterThanOrEqual(18);
      expect(r.age as number).toBeLessThanOrEqual(65);
    }
  });

  it("supports nested objects and arrays", async () => {
    const out = await new DataGhost({ seed: 1 }).generate({ schema, count: 20 });
    for (const r of out) {
      expect(Object.keys(r.address as object)).toEqual(["street", "city", "postalCode"]);
      expect((r.address as { postalCode: string }).postalCode).toMatch(/^\d{5}$/);
      const tags = r.tags as string[];
      expect(tags.length).toBeGreaterThanOrEqual(1);
      expect(tags.length).toBeLessThanOrEqual(3);
    }
  });

  it("respects null and missing rates", async () => {
    const out = await new DataGhost({ seed: 2 }).generate({ schema, count: 2000 });
    const nulls = out.filter((r) => r.nickname === null).length / out.length;
    const missing = out.filter((r) => !("middleName" in r)).length / out.length;
    expect(nulls).toBeGreaterThan(0.45);
    expect(nulls).toBeLessThan(0.55);
    expect(missing).toBeGreaterThan(0.45);
    expect(missing).toBeLessThan(0.55);
  });

  it("is deterministic for the same seed and differs across seeds", async () => {
    const a = await new DataGhost({ seed: 42 }).generate({ schema, count: 50 });
    const b = await new DataGhost({ seed: 42 }).generate({ schema, count: 50 });
    const c = await new DataGhost({ seed: 43 }).generate({ schema, count: 50 });
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
    expect(await new DataGhost({ seed: "fixture-v1" }).generate({ schema, count: 5 })).toEqual(await new DataGhost({ seed: "fixture-v1" }).generate({ schema, count: 5 }));
  });

  it("keeps other fields stable when a field is added", async () => {
    const a = await new DataGhost({ seed: 7 }).generate({ schema: { name: "fullName", age: "integer" }, count: 20 });
    const b = await new DataGhost({ seed: 7 }).generate({ schema: { name: "fullName", extra: "uuid", age: "integer" }, count: 20 });
    expect(b.map((r) => r.name)).toEqual(a.map((r) => r.name));
    expect(b.map((r) => r.age)).toEqual(a.map((r) => r.age));
  });

  it("streams exactly the same records as generate()", async () => {
    const ghost = new DataGhost({ seed: 99 });
    const batch = await ghost.generate({ schema, count: 300 });
    const streamed: unknown[] = [];
    for await (const r of ghost.stream({ schema, count: 300 })) streamed.push(r);
    expect(streamed).toEqual(batch);
  });

  it("streams large outputs without retaining records", async () => {
    const ghost = new DataGhost({ seed: 5 });
    let n = 0;
    let last: unknown;
    for await (const r of ghost.stream({ schema: { id: { type: "sequence" }, v: "decimal" }, count: 200_000 })) {
      n++;
      last = r;
    }
    expect(n).toBe(200_000);
    expect((last as { id: number }).id).toBe(200_000);
  });

  it("enforces uniqueness and reports exhausted generators", async () => {
    const ghost = new DataGhost({ seed: 3 });
    const out = await ghost.generate({ schema: { code: { type: "integer", min: 1, max: 1000, unique: true } }, count: 500 });
    expect(new Set(out.map((r) => r.code)).size).toBe(500);
    await expect(ghost.generate({ schema: { code: { type: "integer", min: 1, max: 5, unique: true } }, count: 10 })).rejects.toThrow(GenerationError);
  });

  it("supports custom function generators in the SDK", async () => {
    const ghost = new DataGhost({ seed: 1, generators: { sku: (ctx) => `SKU-${String(ctx.index).padStart(4, "0")}` } });
    ghost.registerGenerator("tier", (ctx) => ctx.rng.pick(["gold", "silver"]));
    const out = await ghost.generate({
      schema: { sku: "sku", tier: "tier", label: { type: "custom", generate: (ctx) => `${ctx.siblings.sku}-${ctx.siblings.tier}` } },
      count: 3,
    });
    expect(out[0]!.sku).toBe("SKU-0000");
    expect(out[2]!.label).toBe(`SKU-0002-${out[2]!.tier}`);
  });

  it("wraps values for MongoDB extended JSON", async () => {
    const [r] = await new DataGhost({ seed: 1 }).generate({ schema: { at: { type: "timestamp", wrap: "$date" } }, count: 1 });
    expect(Object.keys(r!.at as object)).toEqual(["$date"]);
  });

  it("uses a fixed reference date for relative dates", async () => {
    const s = { d: { type: "date", from: "-30d", to: "now" } };
    const a = await new DataGhost({ seed: 1 }).generate({ schema: s, count: 10 });
    for (const r of a) expect(r.d as string <= "2026-01-01" && (r.d as string) >= "2025-12-02").toBe(true);
    const b = await new DataGhost({ seed: 1, referenceDate: "2030-06-01" }).generate({ schema: s, count: 10 });
    for (const r of b) expect((r.d as string).startsWith("2030-0")).toBe(true);
  });
});

describe("invalid schemas and configurations", () => {
  const ghost = new DataGhost({ seed: 1 });
  const bad: [string, SchemaInput, RegExp][] = [
    ["unknown generator", { a: "nope" }, /Unknown generator "nope" at "a"/],
    ["bad option", { a: { type: "integer", min: 5, max: 1 } }, /max must be >= min/],
    ["unknown option", { a: { type: "email", domian: "x" } }, /unknown option/],
    ["bad nullable", { a: { type: "email", nullable: 3 } }, /nullable/],
    ["array without items", { a: { type: "array" } as never }, /needs "items"/],
    ["array bounds", { a: { type: "array", items: "email", minItems: 5, maxItems: 1 } }, /maxItems/],
    ["empty schema", {}, /no fields/],
    ["forbidden key", JSON.parse('{"__proto__": "email"}'), /not allowed/],
    ["dotted key", { "a.b": "email" }, /cannot contain/],
    ["object without fields", { a: { type: "object" } as never }, /needs "fields"/],
  ];
  for (const [label, s, re] of bad) {
    it(label, async () => {
      await expect(ghost.generate({ schema: s, count: 1 })).rejects.toThrow(re);
    });
  }

  it("throws typed errors", async () => {
    await expect(ghost.generate({ schema: { a: "nope" }, count: 1 })).rejects.toBeInstanceOf(InvalidSchemaError);
    await expect(ghost.generate({ schema: { a: "email" }, count: -1 })).rejects.toBeInstanceOf(ConfigError);
    expect(() => new DataGhost({ seed: 1.5 })).toThrow(ConfigError);
    expect(() => new DataGhost({ referenceDate: "nope" })).toThrow(ConfigError);
  });

  it("rejects function generators in non-SDK contexts", async () => {
    const { normalizeSchema, defaultRegistry } = await import("@workfonic/dataghost");
    expect(() => normalizeSchema({ a: { type: "custom", generate: () => 1 } }, { registry: defaultRegistry })).toThrow(/only available in the SDK/);
  });
});

describe("generateDataset", () => {
  const config = {
    collections: {
      departments: { count: 6, schema: { departmentId: { type: "sequence", prefix: "DEPT-", pad: 2 }, name: "department" } },
      employees: {
        count: 300,
        schema: {
          employeeId: { type: "employeeId", prefix: "EMP-", pad: 4 },
          name: "fullName",
          departmentId: "string",
          managerId: { type: "string", nullable: 0.05 },
          address: { city: "city" },
        },
      },
      orders: {
        count: 500,
        schema: { orderId: "orderId", items: { type: "array", items: { productId: "string", qty: { type: "integer", min: 1, max: 5 } }, minItems: 1, maxItems: 4 } },
      },
      products: { count: 40, schema: { productId: "productId", price: { type: "currencyAmount", min: 1, max: 500 } } },
    },
    relationships: [
      { from: "employees.departmentId", to: "departments.departmentId" },
      { from: "employees.managerId", to: "employees.employeeId" },
      { from: "orders.items[].productId", to: "products.productId" },
      { from: "orders.salesRepId", to: "employees.employeeId" },
    ],
  };

  it("maintains referential integrity across collections", async () => {
    const { data, report } = await new DataGhost({ seed: 10 }).generateDataset(config);
    expect(report.integrity.valid).toBe(true);
    expect(report.order.indexOf("departments")).toBeLessThan(report.order.indexOf("employees"));
    expect(report.order.indexOf("products")).toBeLessThan(report.order.indexOf("orders"));
    const depts = new Set(data.departments!.map((d) => d.departmentId));
    const emps = new Set(data.employees!.map((e) => e.employeeId));
    for (const e of data.employees!) {
      expect(depts.has(e.departmentId)).toBe(true);
      if (e.managerId !== null) expect(emps.has(e.managerId)).toBe(true);
    }
    // Auto-added FK field.
    for (const o of data.orders!) expect(emps.has(o.salesRepId)).toBe(true);
    expect(validateIntegrity(data, config.relationships).valid).toBe(true);
    // Collection order in the output matches the config.
    expect(Object.keys(data)).toEqual(["departments", "employees", "orders", "products"]);
  });

  it("is reproducible with consistent identifiers", async () => {
    const a = await new DataGhost({ seed: 10 }).generateDataset(config);
    const b = await new DataGhost({ seed: 10 }).generateDataset(config);
    expect(a.data).toEqual(b.data);
    const c = await new DataGhost({ seed: 11 }).generateDataset(config);
    expect(c.data.employees!.map((e) => e.departmentId)).not.toEqual(a.data.employees!.map((e) => e.departmentId));
  });

  it("detects circular dependencies", async () => {
    await expect(
      new DataGhost({ seed: 1 }).generateDataset({
        collections: { a: { count: 2, schema: { id: "uuid", bId: "string" } }, b: { count: 2, schema: { id: "uuid", aId: "string" } } },
        relationships: [
          { from: "a.bId", to: "b.id" },
          { from: "b.aId", to: "a.id" },
        ],
      }),
    ).rejects.toThrow(/Circular dependency between collections: a -> b -> a/);
  });

  it("allows deferred cycles", async () => {
    const { report } = await new DataGhost({ seed: 1 }).generateDataset({
      collections: { a: { count: 3, schema: { id: "uuid", bId: "string" } }, b: { count: 3, schema: { id: "uuid", aId: "string" } } },
      relationships: [
        { from: "a.bId", to: "b.id" },
        { from: "b.aId", to: "a.id", deferred: true },
      ],
    });
    expect(report.integrity.valid).toBe(true);
  });

  it("rejects relationships to unknown fields or nullable keys", async () => {
    const ghost = new DataGhost({ seed: 1 });
    await expect(ghost.generateDataset({ collections: { a: { count: 1, schema: { id: "uuid" } } }, relationships: [{ from: "a.x", to: "b.id" }] })).rejects.toThrow(/unknown collection "b"/);
    await expect(ghost.generateDataset({ collections: { a: { count: 1, schema: { id: "uuid" } }, b: { count: 1, schema: { x: "uuid" } } }, relationships: [{ from: "b.y", to: "a.nope" }] })).rejects.toThrow(/not a field/);
    await expect(ghost.generateDataset({ collections: { a: { count: 1, schema: { id: { type: "uuid", nullable: true } } }, b: { count: 1, schema: { x: "uuid" } } }, relationships: [{ from: "b.y", to: "a.id" }] })).rejects.toThrow(/must not be nullable/);
    await expect(ghost.generateDataset({ collections: { a: { count: 1, schema: { id: "uuid" } }, b: { count: 1, schema: { x: "uuid" } } }, relationships: [{ from: "b.deep.y", to: "a.id" }] })).rejects.toThrow(/not in the "b" schema/);
  });

  it("refuses to generate invalid foreign keys", async () => {
    await expect(
      new DataGhost({ seed: 1 }).generateDataset({
        collections: { users: { count: 0, schema: { id: "uuid" } }, posts: { count: 5, schema: { authorId: "string" } } },
        relationships: [{ from: "posts.authorId", to: "users.id" }],
      }),
    ).rejects.toThrow(/cannot be satisfied/);
  });

  it("supports one-to-one and one-to-many", async () => {
    const { data } = await new DataGhost({ seed: 4 }).generateDataset({
      collections: {
        users: { count: 20, schema: { id: { type: "sequence" } } },
        profiles: { count: 20, schema: { userId: "integer" } },
        posts: { count: 70, schema: { authorId: "integer" } },
      },
      relationships: [
        { from: "profiles.userId", to: "users.id", type: "one-to-one" },
        { from: "posts.authorId", to: "users.id", type: "one-to-many", minChildren: 2, maxChildren: 5 },
      ],
    });
    expect(new Set(data.profiles!.map((p) => p.userId)).size).toBe(20);
    const per = new Map<unknown, number>();
    for (const p of data.posts!) per.set(p.authorId, (per.get(p.authorId) ?? 0) + 1);
    expect(per.size).toBe(20);
    for (const n of per.values()) expect(n >= 2 && n <= 5).toBe(true);
  });

  it("forces unique keys on referenced fields", async () => {
    const { data } = await new DataGhost({ seed: 4 }).generateDataset({
      collections: { codes: { count: 50, schema: { code: { type: "pattern", pattern: "[A-Z]{3}" } } }, refs: { count: 10, schema: { c: "string" } } },
      relationships: [{ from: "refs.c", to: "codes.code" }],
    });
    expect(new Set(data.codes!.map((c) => c.code)).size).toBe(50);
  });
});

describe("synthesize from a source dataset", () => {
  const source = {
    departments: [
      { departmentId: "D-1", name: "Engineering" },
      { departmentId: "D-2", name: "Sales" },
    ],
    employees: Array.from({ length: 10 }, (_, i) => ({ employeeId: `E-${i + 1}`, departmentId: i % 2 ? "D-1" : "D-2", managerId: i === 0 ? null : `E-${Math.ceil(i / 2)}`, email: `p${i}@corp.example` })),
  };

  it("scales counts proportionally and keeps relationships", async () => {
    const out = await new DataGhost({ seed: 1 }).synthesize(source, { count: 100 });
    expect(out.data.employees).toHaveLength(100);
    expect(out.data.departments).toHaveLength(20);
    expect(out.report.integrity.valid).toBe(true);
    expect(out.report.integrity.stats).toHaveLength(2);
  });

  it("accepts per-collection counts", async () => {
    const out = await new DataGhost({ seed: 1 }).synthesize(source, { count: { departments: 3, employees: 7 } });
    expect(out.data.departments).toHaveLength(3);
    expect(out.data.employees).toHaveLength(7);
    await expect(new DataGhost({ seed: 1 }).synthesize(source, { count: { nope: 3 } })).rejects.toThrow(/unknown collection/);
  });

  it("never copies source values for sensitive fields", async () => {
    const out = await new DataGhost({ seed: 1 }).synthesize(source, { count: 50 });
    const text = JSON.stringify(out.data);
    for (let i = 0; i < 10; i++) expect(text).not.toContain(`p${i}@corp.example`);
  });

  it("throws CircularDependencyError for cyclic configs from the relationship engine", () => {
    expect(new CircularDependencyError(["a", "b", "a"]).message).toMatch(/deferred/);
  });
});
