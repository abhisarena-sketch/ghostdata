import { describe, expect, it } from "vitest";
import {
  compilePattern,
  createRng,
  defaultRegistry,
  GeneratorOptionsError,
  GeneratorRegistry,
  luhnValid,
  PatternError,
  type GeneratorContext,
} from "@workfonic/dataghost-generators";

const REF = new Date("2026-01-01T00:00:00.000Z");

function ctx(seed: string | number = 1, index = 0, siblings: Record<string, unknown> = {}): GeneratorContext {
  return { rng: createRng(seed), index, siblings, referenceDate: REF, path: "field" };
}

function sample(name: string, options: Record<string, unknown> = {}, n = 200, siblings: Record<string, unknown> = {}) {
  const def = defaultRegistry.get(name)!;
  const parsed = defaultRegistry.parseOptions(name, options, name);
  const c = ctx(`sample-${name}`, 0, siblings);
  return Array.from({ length: n }, (_, i) => def.generate({ ...c, index: i }, parsed));
}

describe("rng", () => {
  it("is deterministic for the same seed", () => {
    const a = createRng(42);
    const b = createRng(42);
    expect(Array.from({ length: 50 }, () => a.next())).toEqual(Array.from({ length: 50 }, () => b.next()));
  });

  it("differs across seeds and forks", () => {
    expect(createRng(1).next()).not.toEqual(createRng(2).next());
    const r = createRng("x");
    expect(r.fork("a").next()).not.toEqual(r.fork("b").next());
    expect(createRng("x").fork("a").next()).toEqual(createRng("x").fork("a").next());
  });

  it("int() stays within inclusive bounds and covers them", () => {
    const r = createRng(7);
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) {
      const v = r.int(1, 6);
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(6);
      seen.add(v);
    }
    expect(seen.size).toBe(6);
  });

  it("weighted() respects weights", () => {
    const r = createRng(3);
    let a = 0;
    for (let i = 0; i < 5000; i++) if (r.weighted(["a", "b"], [9, 1]) === "a") a++;
    expect(a / 5000).toBeGreaterThan(0.85);
    expect(a / 5000).toBeLessThan(0.95);
  });

  it("normal() has roughly the requested mean", () => {
    const r = createRng(9);
    let sum = 0;
    for (let i = 0; i < 5000; i++) sum += r.normal(100, 10);
    expect(Math.abs(sum / 5000 - 100)).toBeLessThan(1);
  });
});

describe("personal generators", () => {
  it("emails always use reserved test domains", () => {
    for (const e of sample("email") as string[]) {
      expect(e).toMatch(/^[a-z0-9._]+@(example\.(com|org|net)|mail\.example|test\.example)$/);
    }
  });

  it("emails follow sibling names", () => {
    const [e] = sample("email", {}, 1, { firstName: "Ana", lastName: "Silva" }) as string[];
    expect(e).toMatch(/ana|silva/);
  });

  it("rejects non-reserved email domains", () => {
    expect(() => defaultRegistry.parseOptions("email", { domain: "gmail.com" }, "email")).toThrow(GeneratorOptionsError);
    expect(defaultRegistry.parseOptions("email", { domain: "corp.example.com" }, "email")).toEqual({ domain: "corp.example.com" });
  });

  it("phones use fictional ranges", () => {
    for (const p of sample("phone") as string[]) {
      expect(p).toMatch(/^(\+1 \d{3}-555-01\d{2}|\+44 7700 900\d{3})$/);
    }
    for (const p of sample("phone", { country: "US", format: "e164" }) as string[]) expect(p).toMatch(/^\+1\d{3}55501\d{2}$/);
  });

  it("dateOfBirth respects the age range", () => {
    for (const d of sample("dateOfBirth", { minAge: 18, maxAge: 65 }) as string[]) {
      const age = (REF.getTime() - new Date(d).getTime()) / (365.25 * 86400000);
      expect(age).toBeGreaterThanOrEqual(17.99);
      expect(age).toBeLessThan(66.1);
    }
  });

  it("address can be an object", () => {
    const [a] = sample("address", { format: "object", country: "GB" }, 1) as Record<string, string>[];
    expect(Object.keys(a!)).toEqual(["street", "city", "postalCode", "country"]);
    expect(a!.postalCode).toMatch(/^[A-Z]{2}\d \d[A-Z]{2}$/);
  });

  it("fullName reuses sibling first and last names", () => {
    const [n] = sample("fullName", {}, 1, { firstName: "Mei", lastName: "Tanaka" });
    expect(n).toBe("Mei Tanaka");
  });
});

describe("professional generators", () => {
  it("employeeId is sequential and padded", () => {
    expect(sample("employeeId", { prefix: "EMP-", pad: 3 }, 3)).toEqual(["EMP-001", "EMP-002", "EMP-003"]);
  });

  it("salary stays within bounds and is rounded", () => {
    for (const s of sample("salary", { min: 40000, max: 90000, roundTo: 1000 }) as number[]) {
      expect(s).toBeGreaterThanOrEqual(40000);
      expect(s).toBeLessThanOrEqual(90000);
      expect(s % 1000).toBe(0);
    }
  });

  it("salaryStructure totals add up", () => {
    for (const s of sample("salaryStructure", {}, 50) as Record<string, number>[]) {
      expect(s.total).toBe(s.base! + s.bonus! + s.allowances!);
    }
  });

  it("jobTitle matches a sibling department", () => {
    const titles = sample("jobTitle", {}, 30, { department: "Finance" }) as string[];
    for (const t of titles) expect(["Financial Analyst", "Accountant", "Controller", "Payroll Specialist"]).toContain(t);
  });
});

describe("technical generators", () => {
  it("uuids are well-formed v4 layout", () => {
    const ids = sample("uuid", {}, 500) as string[];
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(new Set(ids).size).toBe(500);
  });

  it("ips are from documentation ranges", () => {
    for (const ip of sample("ipv4") as string[]) expect(ip).toMatch(/^(192\.0\.2|198\.51\.100|203\.0\.113)\.\d{1,3}$/);
    for (const ip of sample("ipv6", {}, 20) as string[]) expect(ip.startsWith("2001:db8:")).toBe(true);
  });

  it("urls use example domains", () => {
    for (const u of sample("url") as string[]) expect(new URL(u).hostname).toMatch(/(^|\.)example\.(com|org|net)$/);
  });

  it("card numbers never pass the Luhn check", () => {
    for (const c of sample("cardNumber", {}, 1000) as string[]) {
      const digits = c.replace(/\D/g, "");
      expect(digits).toHaveLength(16);
      expect(digits.startsWith("0000")).toBe(true);
      expect(luhnValid(digits)).toBe(false);
    }
  });

  it("government ids use the never-issued 000 area", () => {
    for (const g of sample("governmentId") as string[]) expect(g).toMatch(/^000-\d{2}-\d{4}$/);
  });

  it("secrets are clearly synthetic", () => {
    for (const s of sample("secret") as string[]) expect(s).toMatch(/^dg_test_[0-9a-f]{24}$/);
  });

  it("objectId supports extended JSON", () => {
    const [o] = sample("objectId", { extendedJson: true }, 1) as { $oid: string }[];
    expect(o!.$oid).toMatch(/^[0-9a-f]{24}$/);
  });
});

describe("numeric generators", () => {
  it("integer respects bounds for all distributions", () => {
    for (const distribution of ["uniform", "normal", "exponential"]) {
      for (const v of sample("integer", { min: 5, max: 10, distribution }) as number[]) {
        expect(Number.isInteger(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(5);
        expect(v).toBeLessThanOrEqual(10);
      }
    }
  });

  it("decimal respects precision", () => {
    for (const v of sample("decimal", { min: 0, max: 1, precision: 3 }) as number[]) {
      expect(Math.round(v * 1000) / 1000).toBe(v);
    }
  });

  it("number is integer when bounds are integers", () => {
    for (const v of sample("number", { min: 18, max: 65 }) as number[]) {
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(18);
      expect(v).toBeLessThanOrEqual(65);
    }
  });

  it("rejects min > max and unknown options", () => {
    expect(() => defaultRegistry.parseOptions("integer", { min: 10, max: 1 }, "age")).toThrow(/max must be >= min/);
    expect(() => defaultRegistry.parseOptions("integer", { mni: 1 }, "age")).toThrow(/unknown option/);
  });
});

describe("temporal generators", () => {
  it("date honours ranges including relative offsets", () => {
    for (const d of sample("date", { from: "2020-01-01", to: "2020-12-31" }) as string[]) {
      expect(d >= "2020-01-01" && d <= "2020-12-31").toBe(true);
    }
    for (const d of sample("date", { from: "-1y", to: "now" }) as string[]) {
      expect(d >= "2025-01-01" && d <= "2026-01-01").toBe(true);
    }
  });

  it("timestamp formats", () => {
    expect(sample("timestamp", {}, 1)[0]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.000Z$/);
    expect(typeof sample("timestamp", { format: "epoch-s" }, 1)[0]).toBe("number");
  });

  it("future and past dates are on the right side of the reference date", () => {
    for (const d of sample("futureDate") as string[]) expect(d > "2026-01-01").toBe(true);
    for (const d of sample("pastDate") as string[]) expect(d < "2026-01-01").toBe(true);
  });

  it("dateRange end follows start", () => {
    for (const r of sample("dateRange") as { start: string; end: string }[]) expect(r.end >= r.start).toBe(true);
  });

  it("renewalDate is after the reference and aligned to a sibling start date", () => {
    const [r] = sample("renewalDate", {}, 1, { startDate: "2023-03-15" }) as string[];
    expect(r).toBe("2026-03-15");
  });

  it("rejects invalid dates", () => {
    expect(() => defaultRegistry.parseOptions("date", { from: "not-a-date" }, "d")).toThrow(GeneratorOptionsError);
  });
});

describe("custom generators", () => {
  it("enum honours weights", () => {
    const vals = sample("enum", { values: ["a", "b"], weights: [1, 0] }) as string[];
    expect(new Set(vals)).toEqual(new Set(["a"]));
  });

  it("enum rejects mismatched weights", () => {
    expect(() => defaultRegistry.parseOptions("enum", { values: ["a"], weights: [1, 2] }, "e")).toThrow(/weights/);
  });

  it("sequence produces numbers or padded strings", () => {
    expect(sample("sequence", {}, 3)).toEqual([1, 2, 3]);
    expect(sample("sequence", { prefix: "INV-", pad: 5, start: 100, step: 10 }, 2)).toEqual(["INV-00100", "INV-00110"]);
  });

  it("constant clones objects", () => {
    const vals = sample("constant", { value: { a: 1 } }, 2) as object[];
    expect(vals[0]).toEqual({ a: 1 });
    expect(vals[0]).not.toBe(vals[1]);
  });

  it("string respects length bounds", () => {
    for (const s of sample("string", { minLength: 3, maxLength: 10 }) as string[]) {
      expect(s.length).toBeGreaterThanOrEqual(3);
      expect(s.length).toBeLessThanOrEqual(10);
    }
  });

  it("registers SDK function generators", () => {
    const reg = new GeneratorRegistry();
    reg.register("sku", (c) => `SKU-${c.index}`);
    expect(reg.get("sku")!.generate(ctx(), {})).toBe("SKU-0");
    expect(() => reg.register("bad name", () => 1)).toThrow(GeneratorOptionsError);
  });

  it("unknown generators produce a helpful error", () => {
    expect(() => defaultRegistry.parseOptions("emial", {}, "user.email")).toThrow(/Unknown generator "emial" at "user.email"/);
  });

  it("resolves aliases", () => {
    expect(defaultRegistry.resolveName("name")).toBe("fullName");
    expect(defaultRegistry.resolveName("zip")).toBe("postalCode");
    expect(defaultRegistry.resolveName("UUID")).toBe("uuid");
  });
});

describe("pattern generator", () => {
  const gen = (p: string, n = 100) => {
    const c = compilePattern(p);
    const r = createRng(p);
    return Array.from({ length: n }, () => c.generate(r));
  };

  it("generates strings that match the pattern", () => {
    const patterns = ["^[A-Z]{3}-\\d{4}$", "(foo|bar)_[a-f0-9]{2,6}", "INV\\d+", "[A-Z][a-z]{3,8}( [A-Z][a-z]{3,8})?", "\\w{5}\\.\\d{2}"];
    for (const p of patterns) {
      const re = new RegExp(`^(?:${p.replace(/^\^|\$$/g, "")})$`);
      for (const s of gen(p)) expect(s).toMatch(re);
    }
  });

  it("rejects unsafe or unsupported constructs", () => {
    for (const p of ["(a)\\1", "(?=a)b", "[^a]", "a{1,1000}", "*a", "(abc", "\\p{L}", "a".repeat(600)]) {
      expect(() => compilePattern(p)).toThrow(PatternError);
    }
  });

  it("is deterministic", () => {
    expect(gen("[a-z]{10}", 5)).toEqual(gen("[a-z]{10}", 5));
  });
});
