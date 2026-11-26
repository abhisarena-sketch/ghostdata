// DataGhost benchmarks. Run with `npm run bench` (builds the packages first).
// Writes docs/benchmarks.md with the measured results. Numbers depend on the machine.
import { writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DataGhost } from "../../packages/core/dist/index.js";

const SIZES = (process.env.BENCH_SIZES ?? "1000,10000,100000").split(",").map(Number);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const employee = {
  id: { type: "sequence" },
  employeeId: { type: "employeeId", unique: true },
  firstName: "firstName",
  lastName: "lastName",
  email: { type: "email", unique: true },
  phone: "phone",
  departmentId: "integer",
  jobTitle: "jobTitle",
  salary: { type: "salary", min: 40000, max: 220000 },
  joiningDate: "joiningDate",
  status: { type: "enum", values: ["active", "probation", "on_leave"], weights: [0.8, 0.1, 0.1] },
  skills: { type: "array", items: "string", minItems: 0, maxItems: 4 },
  address: { street: "street", city: "city", postalCode: "postalCode", country: "country" },
  manager: { type: "integer", nullable: 0.1 },
};
const department = { id: { type: "sequence" }, name: "department", budget: { type: "integer", min: 100000, max: 5000000 } };

function mb(bytes) {
  return (bytes / 1048576).toFixed(1);
}

async function time(fn) {
  const t = performance.now();
  const value = await fn();
  return { ms: performance.now() - t, value };
}

const rows = [];
for (const n of SIZES) {
  globalThis.gc?.();
  const ghost = new DataGhost({ seed: 42 });
  const heapBefore = process.memoryUsage().heapUsed;

  const config = {
    collections: { departments: { count: Math.max(1, Math.round(n / 50)), schema: department }, employees: { count: n, schema: employee } },
    relationships: [{ from: "employees.departmentId", to: "departments.id" }, { from: "employees.manager", to: "employees.id", nullable: true }],
  };
  const gen = await time(() => ghost.generateDataset(config));
  const { data, report } = gen.value;
  if (!report.integrity.valid) throw new Error("integrity failed");
  const heapAfterGen = process.memoryUsage().heapUsed;

  const val = await time(() => ghost.validateDataset(data, { schemas: { employees: employee, departments: department }, relationships: config.relationships }));
  if (!val.value.valid) throw new Error("validation failed: " + JSON.stringify(val.value.schema.employees?.errors?.slice(0, 3)));
  const json = await time(() => ghost.export(data.employees, "json"));
  const jsonl = await time(() => ghost.export(data.employees, "jsonl"));
  const csv = await time(() => ghost.export(data.employees, "csv"));
  const inspect = await time(() => ghost.inspect({ employees: data.employees }));
  const mask = await time(() => ghost.mask({ employees: data.employees }, { relationships: [] }));
  // maxRSS is the process-wide peak so far (kilobytes); sizes run smallest first.
  const peakRss = process.resourceUsage().maxRSS * 1024;

  const total = n + config.collections.departments.count;
  rows.push({
    n,
    total,
    genMs: gen.ms,
    perSec: Math.round(total / (gen.ms / 1000)),
    heapMb: mb(heapAfterGen - heapBefore),
    peakRssMb: mb(peakRss),
    validateMs: val.ms,
    jsonMs: json.ms,
    jsonMb: mb(Buffer.byteLength(json.value)),
    jsonlMs: jsonl.ms,
    csvMs: csv.ms,
    csvMb: mb(Buffer.byteLength(csv.value)),
    inspectMs: inspect.ms,
    maskMs: mask.ms,
  });
  console.log(`${n.toLocaleString("en-US")} employees: generated in ${gen.ms.toFixed(0)} ms`);
}

const f = (ms) => (ms < 10 ? ms.toFixed(1) : Math.round(ms).toLocaleString("en-US"));
const cpu = os.cpus()[0]?.model ?? "unknown CPU";
const md = `# Benchmarks

Measured with \`npm run bench\` on ${new Date().toISOString().slice(0, 10)}.

- Machine: ${cpu}, ${os.cpus().length} logical CPUs, ${mb(os.totalmem())} MB RAM, ${os.platform()} ${os.release()}
- Node.js ${process.version}
- Dataset: \`employees\` (14 fields: nested address, an array, a nullable self-reference, unique email and id) plus \`departments\` (1 per 50 employees), with two foreign keys. Seed 42.

Times are wall-clock milliseconds for one run, so expect some variation. Memory is the heap growth after generation, and the peak resident set size of the whole process so far (sizes run smallest first, so each row includes the earlier ones). Export times are for the employees collection serialised in memory. The CLI streams large outputs to disk instead.

| Employees | Records total | Generate (ms) | Records/s | Heap after generate (MB) | Peak RSS (MB) | Validate + integrity + safety scan (ms) | JSON export (ms / MB) | JSONL export (ms) | CSV export (ms / MB) | Inspect (ms) | Mask (ms) |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
${rows
  .map((r) => `| ${r.n.toLocaleString("en-US")} | ${r.total.toLocaleString("en-US")} | ${f(r.genMs)} | ${r.perSec.toLocaleString("en-US")} | ${r.heapMb} | ${r.peakRssMb} | ${f(r.validateMs)} | ${f(r.jsonMs)} / ${r.jsonMb} | ${f(r.jsonlMs)} | ${f(r.csvMs)} / ${r.csvMb} | ${f(r.inspectMs)} | ${f(r.maskMs)} |`)
  .join("\n")}

Reproduce with \`npm run bench\`, or choose sizes with \`BENCH_SIZES=1000,50000 npm run bench\`.
`;
writeFileSync(path.join(root, "docs/benchmarks.md"), md);
console.log("\nWrote docs/benchmarks.md");
