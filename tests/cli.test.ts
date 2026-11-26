import { mkdtempSync, readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { run, EXIT } from "@workfonic/dataghost-cli";

const COMPANY = path.resolve(__dirname, "../examples/data/company.json");

let cwd: string;
async function dg(...args: string[]) {
  let stdout = "";
  let stderr = "";
  const code = await run(args, { cwd, stdout: (s) => (stdout += s), stderr: (s) => (stderr += s) });
  return { code, stdout, stderr };
}
const read = (p: string) => readFileSync(path.join(cwd, p), "utf8");
const readJson = (p: string) => JSON.parse(read(p));

beforeEach(() => {
  cwd = mkdtempSync(path.join(tmpdir(), "dataghost-cli-"));
  copyFileSync(COMPANY, path.join(cwd, "company.json"));
});

describe("dataghost CLI", () => {
  it("prints help and version", async () => {
    expect((await dg("--help")).stdout).toMatch(/Usage: dataghost <command>/);
    expect((await dg("--version")).stdout).toMatch(/^0\.1\.0/);
    expect((await dg("generate", "--help")).stdout).toMatch(/Usage: dataghost generate/);
    expect((await dg()).code).toBe(EXIT.USAGE);
  });

  it("rejects unknown commands and options with usage errors", async () => {
    expect((await dg("explode")).code).toBe(EXIT.USAGE);
    const r = await dg("generate", "company.json", "--colour");
    expect(r.code).toBe(EXIT.USAGE);
    expect(r.stderr).toMatch(/Unknown option/);
    expect((await dg("generate", "company.json", "--count", "abc")).code).toBe(EXIT.USAGE);
    expect((await dg("generate", "company.json", "--format", "xml")).code).toBe(EXIT.USAGE);
    expect((await dg("generate", "company.json", "--mode", "scramble")).code).toBe(EXIT.USAGE);
  });

  it("init writes a config and refuses to overwrite it", async () => {
    expect((await dg("init")).code).toBe(EXIT.OK);
    expect(readJson("dataghost.config.json").collections.employees).toBeDefined();
    const again = await dg("init");
    expect(again.code).toBe(EXIT.OUTPUT);
    expect(again.stderr).toMatch(/--force/);
    expect((await dg("init", "--force")).code).toBe(EXIT.OK);
  });

  it("generates from the init config without an input file", async () => {
    await dg("init");
    const r = await dg("generate", "--format", "csv");
    expect(r.code).toBe(EXIT.OK);
    const files = readdirSync(path.join(cwd, "dataghost-output")).sort();
    expect(files).toEqual(["dataghost.departments.synthetic.csv", "dataghost.employees.synthetic.csv"]);
    const lines = read("dataghost-output/dataghost.employees.synthetic.csv").trim().split("\n");
    expect(lines).toHaveLength(51);
    expect(lines[0]).toContain("address.city");
    // Validate with the same config: schema + relationships.
    const json = await dg("generate", "--format", "json", "--out-dir", "out2");
    expect(json.code).toBe(EXIT.OK);
    const v = await dg("validate", "out2/dataghost.synthetic.json", "--config", "dataghost.config.json");
    expect(v.stdout).toMatch(/Schema employees: ok/);
    expect(v.stdout).toMatch(/Result: valid/);
    expect(v.code).toBe(EXIT.OK);
  });

  it("inspects files in human and JSON form without printing source values", async () => {
    const r = await dg("inspect", "company.json");
    expect(r.code).toBe(EXIT.OK);
    expect(r.stdout).toMatch(/Collection "employees": 8 records/);
    expect(r.stdout).toMatch(/employees\.departmentId -> departments\.departmentId/);
    for (const secret of ["ava.okafor@example.com", "Okafor", "12 Maple Avenue"]) expect(r.stdout + r.stderr).not.toContain(secret);
    const j = await dg("inspect", "company.json", "--json");
    expect(JSON.parse(j.stdout).totals.collections).toBe(2);
  });

  it("inspect --out writes an editable config that generate accepts", async () => {
    expect((await dg("inspect", "company.json", "--out", "cfg/company.config.json")).code).toBe(EXIT.OK);
    const cfg = readJson("cfg/company.config.json");
    expect(cfg.relationships.length).toBe(2);
    const g = await dg("generate", "--config", "cfg/company.config.json", "--count", "employees=30", "--count", "departments=3");
    expect(g.code).toBe(EXIT.OK);
    const out = readJson("dataghost-output/dataghost.synthetic.json");
    expect(out.employees).toHaveLength(30);
    expect(out.departments).toHaveLength(3);
  });

  it("generates reproducible output with a seed", async () => {
    await dg("generate", "company.json", "--count", "40", "--seed", "99", "--out-dir", "a");
    await dg("generate", "company.json", "--count", "40", "--seed", "99", "--out-dir", "b");
    await dg("generate", "company.json", "--count", "40", "--seed", "100", "--out-dir", "c");
    expect(read("a/company.synthetic.json")).toBe(read("b/company.synthetic.json"));
    expect(read("a/company.synthetic.json")).not.toBe(read("c/company.synthetic.json"));
    expect(readJson("a/company.synthetic.json").employees).toHaveLength(40);
  });

  it("reports the random seed when none is configured", async () => {
    const r = await dg("generate", "company.json");
    expect(r.stderr).toMatch(/pass --seed \d+ to reproduce/);
  });

  it("generates CSV from CSV and JSONL from JSON", async () => {
    writeFileSync(path.join(cwd, "people.csv"), "id,name,email,zip,joined\n1,Ana Silva,ana@corp.example,02134,2020-01-02\n2,Kai Weber,kai@corp.example,10001,2021-03-04\n3,Mei Tanaka,mei@corp.example,00501,2019-05-06\n");
    const r = await dg("generate", "people.csv", "--count", "500", "--format", "csv", "--seed", "1");
    expect(r.code).toBe(EXIT.OK);
    const lines = read("dataghost-output/people.synthetic.csv").trim().split("\n");
    expect(lines).toHaveLength(501);
    expect(lines[0]).toBe("id,name,email,zip,joined");
    expect(read("dataghost-output/people.synthetic.csv")).not.toMatch(/corp\.example/);
    const j = await dg("generate", "company.json", "--format", "jsonl", "--seed", "1");
    expect(j.code).toBe(EXIT.OK);
    const emp = read("dataghost-output/company.employees.synthetic.jsonl").trim().split("\n");
    expect(JSON.parse(emp[0]!).employeeId).toMatch(/^EMP-/);
  });

  it("never overwrites the source file", async () => {
    mkdirSync(path.join(cwd, "data"));
    copyFileSync(COMPANY, path.join(cwd, "data", "company.json"));
    const r = await dg("export", "data/company.json", "--format", "json", "--out-dir", "data", "--force");
    expect(r.code).toBe(EXIT.OUTPUT);
    expect(r.stderr).toMatch(/Refusing to overwrite the source file/);
  });

  it("refuses output directories outside the working directory", async () => {
    const r = await dg("generate", "company.json", "--out-dir", "../escape");
    expect(r.code).toBe(EXIT.OUTPUT);
    expect(r.stderr).toMatch(/outside the current directory/);
  });

  it("explains missing files and invalid input with exit codes", async () => {
    const missing = await dg("inspect", "nope.json");
    expect(missing.code).toBe(EXIT.INPUT);
    expect(missing.stderr).toMatch(/not found/);
    writeFileSync(path.join(cwd, "bad.json"), '{"password": "hunter2-secret", oops}');
    const bad = await dg("inspect", "bad.json");
    expect(bad.code).toBe(EXIT.INPUT);
    expect(bad.stderr).toMatch(/Invalid JSON/);
    expect(bad.stderr).not.toContain("hunter2-secret");
  });

  it("reports invalid configs as config errors", async () => {
    writeFileSync(path.join(cwd, "bad.config.json"), JSON.stringify({ collections: { x: { count: 1, schema: { a: "nope" } } } }));
    const r = await dg("generate", "--config", "bad.config.json");
    expect(r.code).toBe(EXIT.CONFIG);
    expect(r.stderr).toMatch(/Unknown generator "nope"/);
    writeFileSync(path.join(cwd, "typo.config.json"), JSON.stringify({ sed: 1 }));
    const t = await dg("generate", "--config", "typo.config.json");
    expect(t.code).toBe(EXIT.CONFIG);
    expect(t.stderr).toMatch(/unknown key\(s\) "sed"/);
  });

  it("reports circular relationships", async () => {
    writeFileSync(
      path.join(cwd, "cyc.config.json"),
      JSON.stringify({
        collections: { a: { count: 2, schema: { id: "uuid", b: "string" } }, b: { count: 2, schema: { id: "uuid", a: "string" } } },
        relationships: [
          { from: "a.b", to: "b.id" },
          { from: "b.a", to: "a.id" },
        ],
      }),
    );
    const r = await dg("generate", "--config", "cyc.config.json");
    expect(r.code).toBe(EXIT.CONFIG);
    expect(r.stderr).toMatch(/Circular dependency/);
  });

  it("masks and preserves with integrity checks", async () => {
    const m = await dg("generate", "company.json", "--mode", "mask", "--seed", "3");
    expect(m.code).toBe(EXIT.OK);
    expect(m.stderr).toMatch(/Referential integrity after transformation: valid/);
    expect(m.stderr).toMatch(/do not guarantee anonymisation/);
    const masked = read("dataghost-output/company.masked.json");
    expect(masked).not.toContain("Okafor");
    const p = await dg("generate", "company.json", "--mode", "preserve", "--seed", "3");
    expect(p.code).toBe(EXIT.OK);
    const preserved = readJson("dataghost-output/company.preserved.json");
    expect(preserved.employees).toHaveLength(8);
  });

  it("previews without writing files", async () => {
    const r = await dg("preview", "company.json", "--count", "2", "--seed", "1");
    expect(r.code).toBe(EXIT.OK);
    const out = JSON.parse(r.stdout);
    expect(out.employees).toHaveLength(2);
    expect(existsSync(path.join(cwd, "dataghost-output"))).toBe(false);
  });

  it("validate fails on dangling references and real-looking values", async () => {
    writeFileSync(
      path.join(cwd, "gen.json"),
      JSON.stringify({
        departments: [{ departmentId: "D1" }, { departmentId: "D2" }],
        employees: [
          { employeeId: "E1", departmentId: "D1", email: "a@example.com" },
          { employeeId: "E2", departmentId: "D9", email: "real.person@gmail.com" },
        ],
      }),
    );
    writeFileSync(path.join(cwd, "rels.json"), JSON.stringify([{ from: "employees.departmentId", to: "departments.departmentId" }]));
    const r = await dg("validate", "gen.json", "--relationships", "rels.json");
    expect(r.code).toBe(EXIT.VALIDATION_FAILED);
    expect(r.stdout).toMatch(/references "D9"/);
    expect(r.stdout).toMatch(/does not use a reserved test domain/);
    const j = await dg("validate", "gen.json", "--relationships", "rels.json", "--json");
    expect(JSON.parse(j.stdout).valid).toBe(false);
  });

  it("validates against a schema file", async () => {
    writeFileSync(path.join(cwd, "recs.json"), JSON.stringify([{ age: 20 }, { age: 200 }]));
    writeFileSync(path.join(cwd, "schema.json"), JSON.stringify({ age: { type: "integer", min: 0, max: 120 } }));
    const r = await dg("validate", "recs.json", "--schema", "schema.json");
    expect(r.code).toBe(EXIT.VALIDATION_FAILED);
    expect(r.stdout).toMatch(/record 1 age: value 200 is above max 120/);
  });

  it("exports between formats", async () => {
    await dg("generate", "company.json", "--seed", "5", "--count", "20");
    const r = await dg("export", "dataghost-output/company.synthetic.json", "--format", "jsonl", "--out-dir", "exported");
    expect(r.code).toBe(EXIT.OK);
    expect(readdirSync(path.join(cwd, "exported")).sort()).toEqual(["company.synthetic.departments.jsonl", "company.synthetic.employees.jsonl"]);
    const c = await dg("export", "exported/company.synthetic.employees.jsonl", "--format", "csv", "--out-dir", "exported");
    expect(c.code).toBe(EXIT.OK);
    expect(read("exported/company.synthetic.employees.csv").split("\n")[0]).toMatch(/^employeeId,/);
    expect((await dg("export", "company.json")).code).toBe(EXIT.USAGE);
  });

  it("streams large inputs above the in-memory limit", async () => {
    const lines = Array.from({ length: 20000 }, (_, i) => JSON.stringify({ id: i + 1, email: `user${i}@corp.example`, score: i % 100, tier: ["a", "b", "c"][i % 3] }));
    writeFileSync(path.join(cwd, "big.jsonl"), lines.join("\n") + "\n");
    const g = await dg("generate", "big.jsonl", "--max-input-mb", "0.5", "--format", "jsonl", "--seed", "1", "--count", "30000");
    expect(g.code).toBe(EXIT.OK);
    expect(g.stderr).toMatch(/streaming it/);
    expect(read("dataghost-output/big.synthetic.jsonl").trim().split("\n")).toHaveLength(30000);
    const m = await dg("generate", "big.jsonl", "--max-input-mb", "0.5", "--mode", "mask", "--format", "csv", "--seed", "1");
    expect(m.code).toBe(EXIT.OK);
    const csv = read("dataghost-output/big.masked.csv").trim().split("\n");
    expect(csv).toHaveLength(20001);
    expect(csv.join("\n")).not.toContain("corp.example");
  });

  it("lists generators", async () => {
    const r = await dg("generators");
    expect(r.stdout).toMatch(/employeeId/);
    expect(JSON.parse((await dg("generators", "--json")).stdout).length).toBeGreaterThan(40);
  });
});
