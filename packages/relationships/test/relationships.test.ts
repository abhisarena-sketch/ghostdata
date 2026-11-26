import { describe, expect, it } from "vitest";
import { createRng } from "@workfonic/dataghost-generators";
import {
  assignForeignKeys,
  CircularDependencyError,
  dependencyOrder,
  detectRelationships,
  getAll,
  normalizeRelationship,
  normalizeRelationships,
  parsePath,
  PathError,
  RelationshipConfigError,
  validateIntegrity,
  visitPath,
} from "@workfonic/dataghost-relationships";

const depts = () => Array.from({ length: 4 }, (_, i) => ({ departmentId: `DEPT-0${i + 1}`, name: `Dept ${i + 1}` }));
const emps = (n: number) => Array.from({ length: n }, (_, i) => ({ employeeId: `EMP-${String(i + 1).padStart(3, "0")}`, departmentId: "x", managerId: "x" }));

describe("paths", () => {
  it("parses nested and array paths", () => {
    expect(parsePath("items[].productId")).toEqual([
      { key: "items", each: true },
      { key: "productId", each: false },
    ]);
  });

  it("rejects prototype pollution keys and malformed paths", () => {
    expect(() => parsePath("__proto__.x")).toThrow(PathError);
    expect(() => parsePath("a..b")).toThrow(PathError);
    expect(() => parsePath("")).toThrow(PathError);
  });

  it("visits array elements", () => {
    const rec = { items: [{ p: 1 }, { p: 2 }, { q: 3 }] };
    expect(getAll(rec, "items[].p")).toEqual([1, 2]);
    visitPath(rec, "items[].p", (h) => h.set(`P${h.value}`));
    expect(rec.items).toEqual([{ p: "P1" }, { p: "P2" }, { q: 3 }]);
  });
});

describe("normalizeRelationship", () => {
  it("parses string endpoints", () => {
    const r = normalizeRelationship({ from: "employees.departmentId", to: "departments.departmentId" });
    expect(r.from.collection).toBe("employees");
    expect(r.type).toBe("many-to-one");
    expect(r.self).toBe(false);
  });

  it("rejects invalid configurations", () => {
    expect(() => normalizeRelationship({ from: "employees", to: "departments.id" })).toThrow(RelationshipConfigError);
    expect(() => normalizeRelationship({ from: "a.x", to: "b.items[].id" })).toThrow(/cannot be inside an array/);
    expect(() => normalizeRelationship({ from: "a.x", to: "b.id", type: "many-to-many" as never })).toThrow(/unknown type/);
    expect(() => normalizeRelationship({ from: "a.x", to: "b.id", nullable: 2 })).toThrow(/nullable/);
    expect(() => normalizeRelationship({ from: "a.x", to: "a.x" })).toThrow(/cannot reference itself/);
    expect(() => normalizeRelationship({ from: "a.x", to: "b.id", maxChildren: 0 })).toThrow(/maxChildren/);
    expect(() => normalizeRelationships([{ from: "a.x", to: "b.id" }, { from: "a.x", to: "c.id" }])).toThrow(/more than one/);
  });
});

describe("dependencyOrder", () => {
  it("orders parents before children and ignores self references", () => {
    const rels = normalizeRelationships([
      { from: "orders.customerId", to: "customers.id" },
      { from: "orders.items[].productId", to: "products.id" },
      { from: "customers.referrerId", to: "customers.id" },
    ]);
    const order = dependencyOrder(["orders", "customers", "products"], rels);
    expect(order.indexOf("customers")).toBeLessThan(order.indexOf("orders"));
    expect(order.indexOf("products")).toBeLessThan(order.indexOf("orders"));
  });

  it("detects circular dependencies with the cycle path", () => {
    const rels = normalizeRelationships([
      { from: "a.bId", to: "b.id" },
      { from: "b.cId", to: "c.id" },
      { from: "c.aId", to: "a.id" },
    ]);
    try {
      dependencyOrder(["a", "b", "c"], rels);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(CircularDependencyError);
      expect((e as CircularDependencyError).cycle).toEqual(["a", "b", "c", "a"]);
    }
  });

  it("allows cycles broken by deferred edges", () => {
    const rels = normalizeRelationships([
      { from: "a.bId", to: "b.id" },
      { from: "b.aId", to: "a.id", deferred: true },
    ]);
    expect(dependencyOrder(["a", "b"], rels)).toEqual(["b", "a"]);
  });

  it("rejects unknown collections", () => {
    expect(() => dependencyOrder(["a"], normalizeRelationships([{ from: "a.x", to: "zzz.id" }]))).toThrow(/unknown collection "zzz"/);
  });
});

describe("assignForeignKeys", () => {
  it("many-to-one references only existing keys", () => {
    const d = depts();
    const e = emps(100);
    const rel = normalizeRelationship({ from: "employees.departmentId", to: "departments.departmentId" });
    assignForeignKeys(e, d, rel, createRng(1));
    const keys = new Set(d.map((x) => x.departmentId));
    for (const x of e) expect(keys.has(x.departmentId)).toBe(true);
    expect(validateIntegrity({ employees: e, departments: d }, [rel]).valid).toBe(true);
  });

  it("preserves nulls and applies nullable rate", () => {
    const d = depts();
    const e = emps(200).map((x, i) => ({ ...x, departmentId: i % 10 === 0 ? null : "x" }));
    const rel = normalizeRelationship({ from: "employees.departmentId", to: "departments.departmentId", nullable: 0.2 });
    assignForeignKeys(e as never, d, rel, createRng(2));
    const nulls = e.filter((x) => x.departmentId === null).length;
    expect(nulls).toBeGreaterThan(20);
    expect(nulls).toBeLessThan(90);
  });

  it("one-to-one uses each parent at most once and fails when infeasible", () => {
    const users = Array.from({ length: 10 }, (_, i) => ({ id: i + 1 }));
    const profiles = Array.from({ length: 10 }, () => ({ userId: 0 }));
    const rel = normalizeRelationship({ from: "profiles.userId", to: "users.id", type: "one-to-one" });
    assignForeignKeys(profiles, users, rel, createRng(3));
    expect(new Set(profiles.map((p) => p.userId)).size).toBe(10);
    expect(() => assignForeignKeys(Array.from({ length: 11 }, () => ({ userId: 0 })), users, rel, createRng(3))).toThrow(/one-to-one needs at least 11/);
  });

  it("one-to-many honours min and max children", () => {
    const parents = Array.from({ length: 5 }, (_, i) => ({ id: `P${i}` }));
    const children = Array.from({ length: 12 }, () => ({ parentId: "x" }));
    const rel = normalizeRelationship({ from: "c.parentId", to: "p.id", type: "one-to-many", minChildren: 2, maxChildren: 3 });
    assignForeignKeys(children, parents, rel, createRng(4));
    const counts = new Map<string, number>();
    for (const c of children) counts.set(c.parentId, (counts.get(c.parentId) ?? 0) + 1);
    expect(counts.size).toBe(5);
    for (const n of counts.values()) expect(n >= 2 && n <= 3).toBe(true);
    expect(validateIntegrity({ c: children, p: parents }, [rel]).valid).toBe(true);
    expect(() => assignForeignKeys(Array.from({ length: 4 }, () => ({ parentId: "x" })), parents, rel, createRng(4))).toThrow(/minChildren/);
    expect(() => assignForeignKeys(Array.from({ length: 30 }, () => ({ parentId: "x" })), parents, rel, createRng(4))).toThrow(/maxChildren/);
  });

  it("handles nested array foreign keys", () => {
    const products = Array.from({ length: 3 }, (_, i) => ({ sku: `SKU-${i}` }));
    const orders = Array.from({ length: 20 }, () => ({ items: [{ sku: "x" }, { sku: "x" }] }));
    const rel = normalizeRelationship({ from: "orders.items[].sku", to: "products.sku" });
    assignForeignKeys(orders, products, rel, createRng(5));
    const report = validateIntegrity({ orders, products }, [rel]);
    expect(report.valid).toBe(true);
    expect(report.stats[0]!.references).toBe(40);
  });

  it("self references form an acyclic tree", () => {
    const e = emps(200);
    const rel = normalizeRelationship({ from: "employees.managerId", to: "employees.employeeId" });
    assignForeignKeys(e, e, rel, createRng(6));
    expect(e[0]!.managerId).toBeNull();
    const report = validateIntegrity({ employees: e }, [rel]);
    expect(report.valid).toBe(true);
    for (let i = 1; i < e.length; i++) expect(e[i]!.managerId).not.toBe(e[i]!.employeeId);
  });

  it("rejects non-unique parent keys", () => {
    const rel = normalizeRelationship({ from: "c.pid", to: "p.id" });
    expect(() => assignForeignKeys([{ pid: 1 }], [{ id: 1 }, { id: 1 }], rel, createRng(1))).toThrow(/not unique/);
  });

  it("refuses to invent keys when the parent collection is empty", () => {
    const rel = normalizeRelationship({ from: "c.pid", to: "p.id" });
    expect(() => assignForeignKeys([{ pid: 1 }], [], rel, createRng(1))).toThrow(/has no records/);
  });

  it("is deterministic per seed", () => {
    const run = (seed: number) => {
      const e = emps(50);
      assignForeignKeys(e, depts(), normalizeRelationship({ from: "e.departmentId", to: "d.departmentId" }), createRng(seed));
      return e.map((x) => x.departmentId);
    };
    expect(run(11)).toEqual(run(11));
    expect(run(11)).not.toEqual(run(12));
  });
});

describe("validateIntegrity", () => {
  it("reports dangling references, duplicate keys and cycles", () => {
    const report = validateIntegrity(
      {
        departments: [{ id: "D1" }, { id: "D1" }],
        employees: [
          { id: "E1", dept: "D1", mgr: "E2" },
          { id: "E2", dept: "D9", mgr: "E1" },
        ],
      },
      [
        { from: "employees.dept", to: "departments.id" },
        { from: "employees.mgr", to: "employees.id" },
      ],
    );
    expect(report.valid).toBe(false);
    const kinds = report.issues.map((i) => i.kind);
    expect(kinds).toContain("duplicate-key");
    expect(kinds).toContain("dangling-reference");
    expect(kinds).toContain("cycle");
    expect(report.stats[0]!.danglingReferences).toBe(1);
  });

  it("reports one-to-one violations and unknown collections", () => {
    const r1 = validateIntegrity({ u: [{ id: 1 }], p: [{ uid: 1 }, { uid: 1 }] }, [{ from: "p.uid", to: "u.id", type: "one-to-one" }]);
    expect(r1.issues[0]!.kind).toBe("one-to-one-violation");
    const r2 = validateIntegrity({ u: [] }, [{ from: "p.uid", to: "u.id" }]);
    expect(r2.issues[0]!.kind).toBe("unknown-collection");
  });
});

describe("detectRelationships", () => {
  it("finds foreign keys and self references", () => {
    const dataset = {
      departments: [
        { departmentId: "DEPT-01", name: "Engineering" },
        { departmentId: "DEPT-02", name: "Sales" },
      ],
      employees: [
        { employeeId: "EMP-001", departmentId: "DEPT-01", managerId: null },
        { employeeId: "EMP-002", departmentId: "DEPT-01", managerId: "EMP-001" },
        { employeeId: "EMP-003", departmentId: "DEPT-02", managerId: "EMP-001" },
        { employeeId: "EMP-004", departmentId: "DEPT-02", managerId: "EMP-003" },
      ],
    };
    const found = detectRelationships(dataset);
    const dept = found.find((f) => f.from === "employees.departmentId");
    expect(dept).toMatchObject({ to: "departments.departmentId", type: "many-to-one", confidence: 1 });
    const mgr = found.find((f) => f.from === "employees.managerId");
    expect(mgr).toMatchObject({ to: "employees.employeeId" });
    expect(mgr!.nullable).toBeGreaterThan(0);
  });

  it("does not link unrelated small integer ids", () => {
    const found = detectRelationships({
      cats: [{ id: 1 }, { id: 2 }, { id: 3 }],
      invoices: [{ id: 1, lineId: 2 }, { id: 2, lineId: 3 }],
    });
    expect(found.find((f) => f.from === "invoices.lineId")).toBeUndefined();
  });

  it("finds nested array references", () => {
    const found = detectRelationships({
      products: [{ productId: "P1" }, { productId: "P2" }],
      orders: [{ orderId: "O1", items: [{ productId: "P1" }, { productId: "P2" }] }, { orderId: "O2", items: [{ productId: "P2" }] }],
    });
    expect(found.find((f) => f.from === "orders.items[].productId")).toMatchObject({ to: "products.productId" });
  });
});
