# @workfonic/dataghost

The DataGhost SDK: schema inference, seeded synthetic data generation with referential integrity, masking and structure-preserving modes, JSON/JSONL/CSV formats and validation. Realistic test data, zero real identities.

```ts
import { DataGhost } from "@workfonic/dataghost";

const ghost = new DataGhost({ seed: 12345 });
const users = await ghost.generate({ schema: { id: "uuid", name: "fullName", email: "email" }, count: 100 });
const { data } = await ghost.synthesize(sample, { count: 10_000 });
const masked = await ghost.mask(sample);
```

Runs locally in Node.js 20+ and browsers. No uploads, no telemetry. Detection of sensitive fields is heuristic and masking does not guarantee anonymisation.

Docs: [SDK reference](https://github.com/abhisarena-sketch/ghostdata/blob/main/docs/sdk.md) · [Schema guide](https://github.com/abhisarena-sketch/ghostdata/blob/main/docs/schema.md) · [Privacy guide](https://github.com/abhisarena-sketch/ghostdata/blob/main/docs/privacy.md). License: MIT.
