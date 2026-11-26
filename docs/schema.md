# Schema guide

A schema maps field names to field specs. Nested objects are written as nested schemas.

```json
{
  "id": { "type": "sequence", "prefix": "USR-", "pad": 5 },
  "name": "fullName",
  "email": { "type": "email", "unique": true },
  "age": { "type": "integer", "min": 18, "max": 90, "distribution": "normal" },
  "nickname": { "type": "firstName", "nullable": 0.3 },
  "referrer": { "type": "uuid", "optional": true },
  "address": { "street": "street", "city": "city", "postalCode": "postalCode" },
  "tags": { "type": "array", "items": { "type": "enum", "values": ["new", "vip", "trial"] }, "minItems": 0, "maxItems": 3 },
  "createdAt": { "type": "timestamp", "from": "-2y", "to": "now", "wrap": "$date" }
}
```

## Field specs

- **A generator name**, such as `"email"`, uses its defaults.
- **`{ "type": "<generator>", ...options }`** passes options. Options are validated, and unknown or invalid ones are reported with the field path.
- **A nested object** without `type`, or `{ "type": "object", "fields": {...} }`, generates a nested record.
- **`{ "type": "array", "items": <spec>, "minItems", "maxItems" }`** (or `length`) generates an array. Items can be any spec, including objects.

See the [generator reference](generators.md) for every generator and option. Common aliases are accepted (`name` → `fullName`, `int` → `integer`, `datetime` → `timestamp`, and so on).

## Common options

| Option | Effect |
|---|---|
| `nullable` | `true` (10% nulls) or a probability between 0 and 1. |
| `optional` | `true` (10% missing) or a probability that the key is absent. |
| `unique` | Reject duplicates within the collection. DataGhost retries and fails with a clear error if the value space is too small. |
| `wrap` | Wrap the value as `{"<wrap>": value}`, for example `"$oid"` or `"$date"` for MongoDB extended JSON. |
| `description` | Free text for documentation. |

## Overrides

When you inspect a dataset, each field gets a suggested generator. Override any of them by path:

```json
{
  "employees": {
    "salary": { "type": "salary", "min": 50000, "max": 120000 },
    "address.postalCode": { "type": "pattern", "pattern": "[0-9]{5}" },
    "skills[]": { "type": "enum", "values": ["go", "rust", "typescript"] }
  }
}
```

Pass this with `--overrides overrides.json` (CLI), `overrides` (SDK and config), or edit generators in the playground's Inspector. For single-collection data, bare paths work too.

## Determinism

Output depends only on the seed, the schema and options, the record counts, the reference date, and the generator version (`GENERATOR_VERSION`, currently `1.0.0`). Each field draws from its own seeded stream, so adding a field does not change the values of other fields. A change to generator algorithms bumps the generator version and is listed in the [changelog](../CHANGELOG.md).

## Pattern generator

`{ "type": "pattern", "pattern": "[A-Z]{3}-[0-9]{4}" }` supports literals, character classes and ranges, `\d \w \s`, groups with alternation, and quantifiers `? * + {n} {n,m}`. Backreferences, lookarounds and negated classes are rejected, quantifiers are capped at 256 and unbounded ones at 8, and patterns are limited to 500 characters, so a pattern cannot be used to exhaust memory.
