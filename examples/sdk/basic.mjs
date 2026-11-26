// Run after `npm run build:packages`: node examples/sdk/basic.mjs
import { readFileSync } from "node:fs";
import { DataGhost } from "../../packages/core/dist/index.js"; // "@workfonic/dataghost" once installed

const ghost = new DataGhost({ seed: 12345 });

// 1. Generate from a schema.
const users = await ghost.generate({
  schema: {
    id: "uuid",
    name: "fullName",
    email: "email",
    age: { type: "integer", min: 18, max: 80 },
    plan: { type: "enum", values: ["free", "pro", "team"], weights: [6, 3, 1] },
  },
  count: 3,
});
console.log(users);

// 2. Learn from a sample (fictional) and generate more like it.
const sample = JSON.parse(readFileSync(new URL("../data/company.json", import.meta.url), "utf8"));
const inspection = ghost.inspect(sample);
for (const c of inspection.collections) {
  console.log(`\n${c.name}: ${c.recordCount} records`);
  for (const f of c.fields) console.log(`  ${f.path.padEnd(22)} ${f.type.padEnd(8)} ${(f.semanticType ?? "").padEnd(14)} ${f.privacy?.level ?? "none"}`);
}
console.log("\nDetected relationships:", inspection.relationships.map((r) => `${r.from} -> ${r.to}`));

const { data, report } = await ghost.synthesize(sample, { count: 1000 });
console.log(`\nSynthesized ${Object.entries(report.counts).map(([k, v]) => `${v} ${k}`).join(", ")}; integrity valid: ${report.integrity.valid}`);

// 3. Mask a copy. Keys are pseudonymised consistently, so references stay valid.
const masked = await ghost.mask(sample);
console.log("\nMasked first employee:", masked.data.employees[0]);

// 4. Validate and export.
console.log("\nValidation:", ghost.validateDataset(data, { relationships: inspection.relationships }).valid);
console.log(ghost.export(data.departments.slice(0, 3), "csv"));
