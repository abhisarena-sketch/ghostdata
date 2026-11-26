# Relationship guide

A relationship says that a field (`from`) holds values of a key in another collection (`to`). DataGhost generates referenced collections first, then fills every foreign key with a real generated key, and checks integrity after every run. If a relationship cannot be satisfied, generation fails with an error. It never writes broken keys.

```json
"relationships": [
  { "from": "orders.customerId", "to": "customers.id" },
  { "from": "profiles.userId", "to": "users.id", "type": "one-to-one" },
  { "from": "orders.items[].productId", "to": "products.sku" },
  { "from": "employees.managerId", "to": "employees.employeeId", "nullable": true },
  { "from": "invoices.orderId", "to": "orders.id", "type": "one-to-many", "minChildren": 1, "maxChildren": 5 }
]
```

Endpoints are `"collection.path"` strings or `{ "collection": "...", "field": "..." }` objects. Paths may be nested (`billing.accountId`) and the `from` side may sit inside arrays (`items[].productId`). The `to` key must not be inside an array.

## Types

| Type | Meaning |
|---|---|
| `many-to-one` (default) | Many children can reference the same parent. Parents are picked at random. |
| `one-to-many` | Same direction, with `minChildren` and `maxChildren` per parent. DataGhost checks that the counts can be met and fails early if not. |
| `one-to-one` | Every child references a different parent. Needs at least as many parents as children. |

## Options

| Option | Effect |
|---|---|
| `nullable` | `true` or a probability: some foreign keys are `null` instead of referencing a parent. |
| `selfReference` | For a collection that references itself: `"tree"` (default) builds an acyclic hierarchy where record *i* points at an earlier record, so the first record is a root with `null`; `"any"` allows any record. |
| `deferred` | Ignore this edge when ordering collections. Use it to break a cycle. The keys are filled after both sides exist. |
| `name` | A label used in errors and reports. |

Referenced keys are made unique automatically. If a `from` field is missing from the schema it is added.

## Ordering and cycles

Collections are generated in topological order. A cycle between collections, such as `a → b → a`, raises `CircularDependencyError` with the cycle path. Mark one edge `deferred` to resolve it. Self-references are not cycles.

## Integrity checks

`validateIntegrity` (SDK), `dataghost validate` (CLI) and the playground report:

- dangling references (a key that does not exist in the parent collection)
- duplicate or missing parent keys
- one-to-one violations and cardinality outside `minChildren..maxChildren`
- cycles in a self-referencing tree
- unknown collections

## Detection

`inspect` suggests relationships from field names (`customerId` → `customers.id`), value overlap and self-references (`managerId` → `employees.employeeId`). Each suggestion has a confidence, the share of values that matched (coverage) and a reason. Suggestions are heuristics: review them before relying on them. In the CLI, `--relationships file.json` replaces detected relationships, and in the playground the Relationships tab lets you add, change or remove them.

## Masking

In mask and preserve modes, keys on both sides of a relationship are pseudonymised with the same mapping, so references stay valid after masking. The mapping is collision-free for identifiers.
