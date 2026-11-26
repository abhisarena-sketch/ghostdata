import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DataGhost, validateIntegrity, type DataRecord } from "@workfonic/dataghost";

const company = JSON.parse(readFileSync(new URL("../../../examples/data/company.json", import.meta.url), "utf8"));

const users = [
  {
    userId: "USR-001",
    fullName: "Ana Silva",
    email: "ana.silva@corp.example",
    password: "correct-horse-battery",
    apiToken: "sk_live_abcdefghijklmnop1234",
    ssn: "123-45-6789",
    card: { number: "4111 1111 1111 1111", expiry: "2027-08-01" },
    lastLoginIp: "8.8.4.4",
    plan: "pro",
    logins: 42,
    profile: { bio: "Ana Silva lives at 42 Maple Avenue", tags: ["admin", "beta"] },
    referrerId: null,
  },
  {
    userId: "USR-002",
    fullName: "Kai Weber",
    email: "kai.weber@corp.example",
    password: "hunter2",
    apiToken: "sk_live_qrstuvwxyzabcdef5678",
    ssn: "987-65-4321",
    card: { number: "5500 0000 0000 0004", expiry: "2026-02-01" },
    lastLoginIp: "1.1.1.1",
    plan: "free",
    logins: 3,
    profile: { bio: "Prefers email", tags: [] },
    referrerId: "USR-001",
  },
  {
    userId: "USR-003",
    fullName: "Mei Tanaka",
    email: "mei.tanaka@corp.example",
    password: "letmein",
    apiToken: "sk_live_ghijklmnopqrstuv9012",
    ssn: "111-22-3333",
    card: { number: "3400 0000 0000 009", expiry: "2028-11-01" },
    lastLoginIp: "9.9.9.9",
    plan: "pro",
    logins: 17,
    profile: { bio: "", tags: ["beta"] },
    referrerId: "USR-001",
  },
];

const SECRETS = ["correct-horse-battery", "hunter2", "letmein", "sk_live_abcdefghijklmnop1234", "sk_live_qrstuvwxyzabcdef5678", "sk_live_ghijklmnopqrstuv9012"];
const PII = ["Ana Silva", "Kai Weber", "Mei Tanaka", "ana.silva@corp.example", "123-45-6789", "4111 1111 1111 1111", "8.8.4.4"];

describe("mask mode", () => {
  it("masks sensitive fields and keeps the rest", async () => {
    const { data, report } = await new DataGhost({ seed: 1 }).mask(users);
    const out = data.records!;
    const text = JSON.stringify(out);
    for (const s of [...SECRETS, ...PII]) expect(text).not.toContain(s);
    // Non-sensitive values are retained.
    expect(out.map((r) => r.plan)).toEqual(["pro", "free", "pro"]);
    expect(out.map((r) => r.logins)).toEqual([42, 3, 17]);
    // Formats are retained.
    expect(out[0]!.email).toMatch(/@example\.com$/);
    expect(out[0]!.ssn).toMatch(/^000-\d{2}-\d{4}$/);
    expect((out[0]!.card as { number: string }).number).toMatch(/^\d{4} \d{4} \d{4} \d{4}$/);
    expect(out[0]!.password).toBe("[REDACTED]");
    expect(out[0]!.lastLoginIp).toMatch(/^(192\.0\.2|198\.51\.100|203\.0\.113)\./);
    expect(report.warnings.join(" ")).toMatch(/detection can miss personal data/);
    expect(report.limitations.join(" ")).toMatch(/do not guarantee anonymisation/);
  });

  it("keeps identifiers consistent so self references stay valid", async () => {
    const { data, report } = await new DataGhost({ seed: 1 }).mask(users);
    const out = data.records!;
    expect(out[1]!.referrerId).toBe(out[0]!.userId);
    expect(out[2]!.referrerId).toBe(out[0]!.userId);
    expect(out[0]!.userId).not.toBe("USR-001");
    expect(out[0]!.userId).toMatch(/^USR-\d{3}$/);
    expect(report.integrity?.valid).toBe(true);
  });

  it("keeps foreign keys valid across collections", async () => {
    const { data, report } = await new DataGhost({ seed: 2 }).mask(company);
    expect(report.integrity?.valid).toBe(true);
    const depts = new Set(data.departments!.map((d) => d.departmentId));
    for (const e of data.employees!) expect(depts.has(e.departmentId)).toBe(true);
    expect(validateIntegrity(data, [{ from: "employees.managerId", to: "employees.employeeId" }]).valid).toBe(true);
  });

  it("honours configured transformations but never keeps secrets", async () => {
    const { data } = await new DataGhost({ seed: 1 }).mask(users, { transformations: { plan: "redact", password: "keep", email: "null" } });
    expect(data.records![0]!.plan).toBe("[REDACTED]");
    expect(data.records![0]!.password).toBe("[REDACTED]");
    expect(data.records![0]!.email).toBeNull();
  });

  it("rejects unknown transformations", async () => {
    await expect(new DataGhost({ seed: 1 }).mask(users, { transformations: { plan: "scramble" as never } })).rejects.toThrow(/Unknown transformation/);
  });

  it("is reproducible with a seed", async () => {
    const a = await new DataGhost({ seed: 5 }).mask(users);
    const b = await new DataGhost({ seed: 5 }).mask(users);
    expect(a.data).toEqual(b.data);
    expect(a.report.warnings.join(" ")).toMatch(/reproducible/);
  });
});

describe("structure-preservation mode", () => {
  it("preserves keys, nesting, nulls, array lengths and types", async () => {
    const { data } = await new DataGhost({ seed: 1 }).preserve(users);
    const out = data.records!;
    expect(out).toHaveLength(users.length);
    out.forEach((r, i) => {
      const src = users[i] as unknown as DataRecord;
      expect(Object.keys(r)).toEqual(Object.keys(src));
      expect(Object.keys(r.card as object)).toEqual(["number", "expiry"]);
      expect((r.profile as { tags: unknown[] }).tags).toHaveLength((src.profile as { tags: unknown[] }).tags.length);
      expect(typeof r.logins).toBe("number");
      expect(Number.isInteger(r.logins)).toBe(true);
      expect((r.card as { expiry: string }).expiry).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
    expect(out[0]!.referrerId).toBeNull();
  });

  it("replaces identifying values and keeps relationships", async () => {
    const { data, report } = await new DataGhost({ seed: 1 }).preserve(users);
    const text = JSON.stringify(data);
    for (const s of [...SECRETS, ...PII]) expect(text).not.toContain(s);
    expect(data.records![1]!.referrerId).toBe(data.records![0]!.userId);
    expect(report.integrity?.valid).toBe(true);
  });

  it("keeps value distributions within the observed ranges", async () => {
    const rows = Array.from({ length: 200 }, (_, i) => ({ id: i + 1, plan: i % 4 === 0 ? "pro" : "free", score: 50 + (i % 50), active: i % 5 === 0 }));
    const { data } = await new DataGhost({ seed: 3 }).preserve(rows);
    const out = data.records!;
    const pro = out.filter((r) => r.plan === "pro").length / out.length;
    expect(pro).toBeGreaterThan(0.15);
    expect(pro).toBeLessThan(0.35);
    for (const r of out) {
      expect(["pro", "free"]).toContain(r.plan);
      expect(r.score as number).toBeGreaterThanOrEqual(50);
      expect(r.score as number).toBeLessThanOrEqual(99);
    }
  });

  it("keeps configured fields", async () => {
    const { data } = await new DataGhost({ seed: 3 }).preserve(users, { keep: ["plan"] });
    expect(data.records!.map((r) => r.plan)).toEqual(["pro", "free", "pro"]);
  });

  it("preserves company relationships", async () => {
    const { data, report } = await new DataGhost({ seed: 9 }).preserve(company);
    expect(report.integrity?.valid).toBe(true);
    expect(data.employees!.map((e) => e.managerId === null)).toEqual(company.employees.map((e: DataRecord) => e.managerId === null));
  });
});
