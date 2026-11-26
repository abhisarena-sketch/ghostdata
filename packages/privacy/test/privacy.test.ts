import { describe, expect, it } from "vitest";
import { createRng, luhnValid } from "@workfonic/dataghost-generators";
import {
  classifyField,
  formatPreserve,
  Pseudonymizer,
  REDACTED,
  scanRecord,
  tokenize,
  transformValue,
  type SensitiveCategory,
  type Transformation,
} from "@workfonic/dataghost-privacy";

const classify = (path: string, samples: unknown[] = []) => classifyField({ path, samples });

describe("tokenize", () => {
  it("splits camel, snake and digits", () => {
    expect(tokenize("homeAddress_line1")).toEqual(["home", "address", "line", "1"]);
    expect(tokenize("APIKey")).toEqual(["api", "key"]);
  });
});

describe("classifyField", () => {
  const cases: [string, unknown[], SensitiveCategory][] = [
    ["email", ["ana.silva@example.com", "kai@example.org"], "email"],
    ["contact", ["ana.silva@example.com", "kai@example.org"], "email"],
    ["phone", ["+1 202-555-0101"], "phone"],
    ["ssn", ["000-12-3456"], "governmentId"],
    ["passportNumber", ["X1234567"], "governmentId"],
    ["cardNumber", ["4111 1111 1111 1111"], "cardNumber"],
    ["password", ["hunter2"], "password"],
    ["passwordHash", ["$2b$10$abcdefghijklmnopqrstuv"], "password"],
    ["accessToken", ["abc"], "authToken"],
    ["session", ["eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJlLXRlc3Q"], "authToken"],
    ["stripeKey", ["sk_test_FAKEFAKEFAKEFAKE1234"], "apiKey"],
    ["apiKey", ["whatever"], "apiKey"],
    ["clientIp", ["192.0.2.10"], "ipAddress"],
    ["firstName", ["Ana"], "personName"],
    ["fullName", ["Ana Silva", "Kai Weber"], "personName"],
    ["address", ["42 Maple Avenue, Springfield"], "address"],
    ["home.street", ["42 Maple Avenue"], "address"],
    ["dob", ["1990-04-12"], "dateOfBirth"],
    ["zip", ["12345"], "quasiIdentifier"],
    ["notes", ["Called about the order"], "freeText"],
    ["employeeId", ["EMP-001", "EMP-002"], "identifier"],
  ];
  for (const [path, samples, expected] of cases) {
    it(`${path} -> ${expected}`, () => {
      expect(classify(path, samples).category).toBe(expected);
    });
  }

  it("uses parent context", () => {
    expect(classify("billingAddress.line1", ["Unit 4"]).category).toBe("address");
    expect(classify("name.first", ["Ana"]).category).toBe("personName");
    expect(classify("card.number", ["0000"]).category).toBe("cardNumber");
  });

  it("does not flag organisation names as person names", () => {
    expect(classify("departments.name", ["Engineering", "Sales"]).level).toBe("none");
    expect(classify("companyName", ["Acme Labs"]).category).not.toBe("personName");
    expect(classify("productName", ["Widget"]).category).not.toBe("personName");
  });

  it("does not flag ordinary fields", () => {
    for (const [path, samples] of [
      ["status", ["active", "inactive"]],
      ["quantity", [1, 2, 3]],
      ["createdAt", ["2024-01-01T00:00:00Z"]],
      ["id", ["3fa85f64-5717-4562-b3fc-2c963f66afa6"]],
      ["price", [9.99]],
    ] as [string, unknown[]][]) {
      const c = classify(path, samples);
      expect(["none", "low"]).toContain(c.level);
    }
  });

  it("detects values even with neutral names, with lower confidence when uncertain", () => {
    const c = classify("field7", ["ana@example.com", "kai@example.com", "mei@example.com"]);
    expect(c.category).toBe("email");
    const token = classify("blob", ["Zx9fK2LqP8wR4tY7uI1oA3sD6gH5jK0l"]);
    expect(token.category).toBe("authToken");
    expect(token.uncertain).toBe(true);
    expect(token.warnings[0]).toMatch(/Review/);
  });

  it("assigns secret level to credentials and high to card numbers", () => {
    expect(classify("password", ["x"]).level).toBe("secret");
    expect(classify("cc", ["4111111111111111"]).level).toBe("high");
  });

  it("never returns source values in the classification", () => {
    const c = classify("email", ["unique-marker-7781@example.com"]);
    expect(JSON.stringify(c)).not.toContain("unique-marker-7781");
  });
});

describe("transformValue", () => {
  const ctx = (category?: SensitiveCategory, p = new Pseudonymizer("s")) => ({ pseudonymizer: p, rng: createRng(1), referenceDate: new Date("2026-01-01"), category });
  const t = (v: unknown, tr: Transformation, c?: SensitiveCategory, p?: Pseudonymizer) => transformValue(v, tr, ctx(c, p));

  it("always redacts secrets, even when 'keep' is configured", () => {
    expect(t("hunter2", "keep", "password")).toBe(REDACTED);
    expect(t("sk_live_x", "generalize", "apiKey")).toBe(REDACTED);
  });

  it("pseudonymises consistently and uses safe domains", () => {
    const p = new Pseudonymizer("s");
    const a = t("real.person@corp.co", "pseudonymize", "email", p);
    const b = t("real.person@corp.co", "pseudonymize", "email", p);
    const c = t("other@corp.co", "pseudonymize", "email", p);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/@example\.com$/);
  });

  it("pseudonymised identifiers keep prefixes and stay unique", () => {
    const p = new Pseudonymizer("s");
    const ids = Array.from({ length: 500 }, (_, i) => `EMP-${String(i).padStart(3, "0")}`);
    const out = ids.map((id) => t(id, "pseudonymize", "identifier", p) as string);
    expect(new Set(out).size).toBe(500);
    for (const o of out) expect(o).toMatch(/^EMP-\d{3}$/);
    // Same mapping from a fresh pseudonymiser with the same secret.
    expect(t("EMP-007", "pseudonymize", "identifier", new Pseudonymizer("s"))).toBe(out[7]);
  });

  it("masks phones into fictional ranges keeping the format", () => {
    const out = t("+44 (20) 7946-0123", "pseudonymize", "phone") as string;
    expect(out).toMatch(/^\+\d\d \(\d\d\) \d{4}-\d{4}$/);
    expect(out.replace(/\D/g, "").endsWith("01" + out.replace(/\D/g, "").slice(-2))).toBe(true);
    expect(out.replace(/\D/g, "")).toMatch(/55501\d\d$/);
  });

  it("masks card numbers into Luhn-invalid values", () => {
    for (let i = 0; i < 50; i++) {
      const out = transformValue("4111-1111-1111-1111", "format-preserve", { ...ctx("cardNumber"), rng: createRng(i) }) as string;
      expect(out).toMatch(/^\d{4}-\d{4}-\d{4}-\d{4}$/);
      expect(luhnValid(out.replace(/-/g, ""))).toBe(false);
    }
  });

  it("masks SSN-like values into the never-issued area", () => {
    expect(t("123-45-6789", "format-preserve", "governmentId")).toMatch(/^000-\d{2}-\d{4}$/);
  });

  it("generalises dates of birth to the year", () => {
    expect(t("1990-04-12", "generalize", "dateOfBirth")).toBe("1990-01-01");
    expect(t(45123, "generalize")).toBe(45000);
  });

  it("maps IPs to documentation ranges", () => {
    expect(t("8.8.8.8", "pseudonymize", "ipAddress")).toMatch(/^(192\.0\.2|198\.51\.100|203\.0\.113)\./);
  });

  it("format-preserve keeps punctuation and case", () => {
    const out = formatPreserve("Ab-12_cD", createRng(1));
    expect(out).toMatch(/^[A-Z][a-z]-\d\d_[a-z][A-Z]$/);
  });

  it("free text is replaced with neutral text of similar length", () => {
    const out = t("Patient Ana Silva called from 555-0101", "synthesize", "freeText") as string;
    expect(out).not.toContain("Ana");
    expect(out.length).toBe(38);
  });

  it("keeps nulls", () => {
    expect(t(null, "pseudonymize", "email")).toBeNull();
  });
});

describe("scanRecord", () => {
  it("flags real-looking values and accepts synthetic ones", () => {
    const findings = scanRecord({
      ok: { email: "a@example.com", ip: "192.0.2.1", phone: "+1 202-555-0101", card: "0000 1234 5678 9010" },
      bad: { email: "a@gmail.com", ip: "8.8.8.8", card: "4111 1111 1111 1111", key: "AKIAABCDEFGHIJKLMNOP" },
    });
    const locs = findings.map((f) => f.location);
    expect(locs).toEqual(expect.arrayContaining(["bad.email", "bad.ip", "bad.card", "bad.key"]));
    expect(locs.some((l) => l.startsWith("ok."))).toBe(false);
  });
});
