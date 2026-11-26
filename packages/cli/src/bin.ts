#!/usr/bin/env node
import { run } from "./index.js";

run(process.argv.slice(2), {
  cwd: process.cwd(),
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
  isTTY: Boolean(process.stderr.isTTY),
}).then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    process.stderr.write(`Unexpected error: ${(err as Error)?.message ?? String(err)}\n`);
    process.exitCode = 70;
  },
);
