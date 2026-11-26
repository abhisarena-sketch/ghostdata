// Regenerates docs/generators.md from the generator registry: `node scripts/generators-doc.mjs` (after build).
import { writeFileSync } from "node:fs";
import { z } from "zod";
import { defaultRegistry, GENERATOR_VERSION } from "../packages/generators/dist/index.js";

const order = ["personal", "professional", "technical", "numeric", "temporal", "text", "custom"];
const defs = defaultRegistry.list();
const describe = (schema) => {
  let json;
  try {
    json = z.toJSONSchema(schema, { unrepresentable: "any", io: "input" });
  } catch {
    return "";
  }
  const props = json.properties ?? {};
  const rows = Object.entries(props).map(([k, p]) => {
    const type = p.enum ? p.enum.map((v) => `\`${JSON.stringify(v)}\``).join(" \\| ") : (p.type ?? (p.anyOf ? p.anyOf.map((a) => a.type ?? (a.enum ? a.enum.join("/") : "value")).join(" \\| ") : "value"));
    const def = p.default !== undefined ? `\`${JSON.stringify(p.default)}\`` : "";
    const extra = [p.minimum !== undefined ? `min ${p.minimum}` : "", p.maximum !== undefined ? `max ${p.maximum}` : ""].filter(Boolean).join(", ");
    return `| \`${k}\` | ${Array.isArray(type) ? type.join(" \\| ") : type}${extra ? ` (${extra})` : ""} | ${def} |`;
  });
  return rows.length ? `\n| Option | Type | Default |\n|---|---|---|\n${rows.join("\n")}\n` : "\nNo options.\n";
};

let md = `# Generator reference

Generated from the registry (generator version ${GENERATOR_VERSION}) by \`scripts/generators-doc.mjs\`. Use a generator by name (\`"email"\`) or with options (\`{ "type": "integer", "min": 1, "max": 9 }\`). Every field also accepts the common options \`nullable\`, \`optional\`, \`unique\`, \`wrap\` and \`description\` (see the [schema guide](schema.md)).

Values that look like personal or secret data are always safe by construction: emails and URLs use reserved RFC 2606 domains, phones use fictional ranges, IPs use documentation ranges, card numbers fail the Luhn check, government identifiers use never-issued prefixes, and secrets are obvious placeholders.
`;
for (const cat of [...order, ...new Set(defs.map((d) => d.category).filter((c) => !order.includes(c)))]) {
  const list = defs.filter((d) => d.category === cat);
  if (!list.length) continue;
  md += `\n## ${cat[0].toUpperCase()}${cat.slice(1)}\n`;
  for (const d of list) md += `\n### \`${d.name}\`\n\n${d.description}\n${describe(d.options)}`;
}
writeFileSync(new URL("../docs/generators.md", import.meta.url), md);
console.log(`Wrote docs/generators.md (${defs.length} generators)`);
