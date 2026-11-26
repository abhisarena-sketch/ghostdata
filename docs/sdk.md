# SDK reference

```ts
import { DataGhost } from "@workfonic/dataghost";
const ghost = new DataGhost({ seed: 12345 });
```

The SDK runs in Node.js 20+ and in modern browsers (the playground uses it). It is ESM-only and has no network or file-system access of its own.

## `new DataGhost(options?)`

| Option | Description |
|---|---|
| `seed` | Number or string. Same seed, input, options and generator version give the same output. A random seed is chosen (and exposed as `ghost.seed`) when omitted. |
| `referenceDate` | The "now" for relative dates such as `pastDate` or `"-5y"`. Default `2026-01-01T00:00:00Z`, so output does not change over time. |
| `generators` | Custom generator functions by name (see `registerGenerator`). |

`ghost.generatorVersion` is the generator algorithm version that determinism is tied to.

## Generating

### `generate({ schema, count, seed?, name? }): Promise<DataRecord[]>`

Generates `count` records for one schema. `generateSync` is the synchronous form. `name` (default `"records"`) is part of the seed derivation, so two collections with the same schema get different data.

### `stream({ schema, count, ... }): AsyncGenerator<DataRecord>`

Yields records one at a time with constant memory.

### `generateDataset({ collections, relationships, seed? })`

```ts
const { data, report } = await ghost.generateDataset({
  collections: {
    customers: { count: 100, schema: { id: "uuid", email: "email" } },
    orders: { count: 400, schema: { id: "orderId", customerId: "uuid", total: "currencyAmount" } },
  },
  relationships: [{ from: "orders.customerId", to: "customers.id" }],
});
report.integrity.valid; // always true: generation throws instead of returning broken keys
```

Collections are generated in dependency order. `report` includes the seed, generator version, order, counts, integrity report and duration.

## Working with existing data

### `parse(text, formatOrFileName?, { name?, maxBytes? }): Dataset`

Parses JSON, JSONL or CSV into a dataset (`{ collectionName: records[] }`). A JSON array becomes one collection; an object whose values are arrays of objects becomes several.

### `inspect(input, { overrides?, detectRelationships?, relationshipThreshold? }): InspectionReport`

Infers each collection's fields (type, semantic type, confidence, null rate, structural example, suggested generator, privacy classification, warnings), a generation schema, suggested relationships, and a privacy summary with warnings and limitations.

### `synthesize(input, { count?, relationships?, useDetectedRelationships?, overrides?, seed? })`

Mode A. Generates new data shaped like the input. A numeric `count` sets the largest collection and scales the others proportionally; an object sets exact counts per collection. Returns `{ data, report, inspection }`.

### `mask(input, options?)` and `preserve(input, options?)`

Modes B and C. Options: `transformations` (`{"collection.path": "redact"}`), `relationships`, `keep` (paths kept in preserve mode), `overrides`, `seed`. Returns `{ data, report, inspection }`; `report` lists each field's transformation and reason, an integrity report, warnings and limitations.

### `configFromInspection(inspection, options?)`

Builds a `generateDataset` config from an inspection, for editing or saving.

## Validating and exporting

- `validate(records, schema)` checks presence, nullability, types, ranges, enums, array lengths and uniqueness.
- `validateDataset(data, { schemas?, relationships?, safetyScan? })` adds referential integrity and a safety scan for real-looking values.
- `export(data, "json" | "jsonl" | "csv", { pretty?, csv? })` serialises records or a dataset (CSV needs a single collection).

## Custom generators

```ts
ghost.registerGenerator("ticketCode", (ctx) => `TCK-${ctx.rng.string(5)}`);
await ghost.generate({ schema: { code: "ticketCode" }, count: 10 });
```

`ctx` has `rng` (seeded; use it for all randomness to keep output reproducible), `index`, `siblings` (fields generated so far in the record), `referenceDate` and `path`. Custom functions are an SDK feature only. Config files and the playground never accept code.

## Errors

All errors extend `DataGhostError` and carry a `code`: `InvalidSchemaError`, `ConfigError`, `ParseError` (with `line`), `GenerationError`, `LimitError`, plus `RelationshipConfigError`, `CircularDependencyError` and `ReferentialIntegrityError` from the relationship engine. Error messages never include source values.

## Lower-level exports

The package also re-exports building blocks: `normalizeSchema`, `inferSchema`, `detectRelationships`, `validateIntegrity`, `classifyField`, `scanRecord`, `createRng`, `defaultRegistry`, the format helpers (`parseCsv`, `toCsv`, `JsonArrayStreamParser`, `CsvStreamParser`, ...) and their types.
