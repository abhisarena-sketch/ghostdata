import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const BIN = path.resolve(__dirname, "../packages/cli/dist/bin.js");

describe.skipIf(!existsSync(BIN))("built dataghost binary", () => {
  it("runs and returns exit codes", () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "dataghost-bin-"));
    expect(execFileSync(process.execPath, [BIN, "--version"], { cwd, encoding: "utf8" })).toMatch(/^0\.1\.0/);
    const r = spawnSync(process.execPath, [BIN, "inspect", "missing.json"], { cwd, encoding: "utf8" });
    expect(r.status).toBe(3);
    expect(r.stderr).toMatch(/Input file not found/);
    const ok = spawnSync(process.execPath, [BIN, "init"], { cwd, encoding: "utf8" });
    expect(ok.status).toBe(0);
    const p = spawnSync(process.execPath, [BIN, "preview", "--count", "2"], { cwd, encoding: "utf8" });
    expect(p.status).toBe(0);
    expect(JSON.parse(p.stdout).employees).toHaveLength(2);
  });
});
