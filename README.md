# DataGhost

**Realistic test data. Zero real identities.**

DataGhost is an open-source synthetic data and privacy utility by Workfonic Labs. It inspects a sample dataset, infers its schema and relationships, flags fields that may hold personal data, and produces test data you can share: brand-new synthetic records, a masked copy, or a structure-preserving copy. Everything runs locally. Nothing is uploaded and nothing is tracked.

- **Schema inference:** types, semantic meaning (email, employeeId, postal code...), confidence, nullability, structural examples that never show source values, a suggested generator for every field, and overrides.
- **57 generators:** personal, professional, technical, numeric, temporal and custom. Emails use reserved domains, phones use fictional ranges, IPs use documentation ranges, card numbers fail the Luhn check, and secrets are obvious placeholders.
- **Relationships:** one-to-one, one-to-many, many-to-one, nested and self-referencing foreign keys, dependency ordering and cycle detection. Every run is checked for referential integrity, and DataGhost fails rather than write broken keys.
- **Three modes:** `synthetic` (new data from the inferred schema), `mask` (replace detected sensitive fields), `preserve` (keep structure, replace every value).
- **Deterministic:** the same seed, input, options and generator version give the same output.
- **CLI, SDK and a browser playground**, with JSON, JSONL and CSV in and out.

> DataGhost **detects** potentially sensitive fields. Detection is heuristic, and masking does not guarantee anonymisation. Read the [privacy and security guide](docs/privacy.md) before sharing output.

## Quick start

Requires Node.js 20 or later.

```bash
npm install --save-dev @workfonic/dataghost-cli

npx dataghost init                      # writes dataghost.config.json
npx dataghost generate --count 1000     # synthetic data from the config
npx dataghost inspect customers.json    # schema, relationships, sensitive fields
npx dataghost generate customers.json --count 5000 --format csv
npx dataghost generate customers.json --mode mask --seed 7
npx dataghost validate dataghost-output/customers.synthetic.json
npx dataghost export dataghost-output/customers.synthetic.json --format jsonl
```

> The packages are prepared for npm but **not yet published**. Until then, clone this repository and run `npm ci && npm run build`, then use `node packages/cli/dist/bin.js` in place of `npx dataghost`.

## SDK

```ts
import { DataGhost } from "@workfonic/dataghost";

const ghost = new DataGhost({ seed: 12345 });

// Generate from a schema
const users = await ghost.generate({
  schema: {
    id: "uuid",
    name: "fullName",
    email: "email",
    age: { type: "integer", min: 18, max: 80 },
    plan: { type: "enum", values: ["free", "pro", "team"], weights: [6, 3, 1] },
  },
  count: 100,
});

// Learn from a sample and generate more like it
const inspection = ghost.inspect(sample);
const { data, report } = await ghost.synthesize(sample, { count: 10_000 });

// Mask a copy, keeping foreign keys consistent
const masked = await ghost.mask(sample);

console.log(ghost.export(users, "csv"));
```

See the [SDK reference](docs/sdk.md).

## Playground

```bash
npm ci
npm run build:packages
npm run dev -w @workfonic/dataghost-playground   # http://localhost:3000
```

The playground is a static Next.js app that runs the real engine in your browser: import a file (up to 10 MB), review the inferred schema and override generators, edit relationships, generate or mask, review privacy detections, and download JSON, JSONL or CSV. A content security policy blocks connections to other origins, and custom generator code is never accepted in the browser.

## Documentation

- [Installation](docs/installation.md)
- [CLI reference](docs/cli.md)
- [SDK reference](docs/sdk.md)
- [Schema guide](docs/schema.md)
- [Generator reference](docs/generators.md)
- [Relationship guide](docs/relationships.md)
- [Privacy and security guide](docs/privacy.md)
- [Benchmarks](docs/benchmarks.md)
- [Releasing](docs/releasing.md)

## Packages

| Package | Purpose |
|---|---|
| [`@workfonic/dataghost`](packages/core) | The SDK: inference, generation, modes, formats, validation |
| [`@workfonic/dataghost-cli`](packages/cli) | The `dataghost` command |
| [`@workfonic/dataghost-generators`](packages/generators) | Seeded RNG and the generator registry |
| [`@workfonic/dataghost-relationships`](packages/relationships) | Foreign keys, ordering and integrity checks |
| [`@workfonic/dataghost-privacy`](packages/privacy) | Sensitive-field detection, transformations and safety scanning |
| [`apps/playground`](apps/playground) | The browser playground (not published) |

## Development

```bash
npm ci
npm run typecheck
npm run lint
npm test
npm run build
npm run bench
```

See [CONTRIBUTING.md](CONTRIBUTING.md). Security issues: [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE) © Workfonic Labs
