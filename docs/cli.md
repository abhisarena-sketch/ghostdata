# CLI reference

```
dataghost <command> [options]
```

All commands run locally. Source values are never printed in logs or errors; parse errors give a line number, not the offending text.

## Commands

### `init`

Writes a starter `dataghost.config.json` (departments and employees with a foreign key and a manager hierarchy). Refuses to overwrite an existing file unless `--force` is given.

### `inspect <file>`

Infers the schema of a JSON, JSONL or CSV file and prints each field's type, semantic type, confidence, null rate, structural example, privacy level and suggested generator, plus detected relationships and privacy warnings.

- `--json` prints the full inspection report as JSON.
- `--out <config.json>` writes a generation config built from the inspection. Edit it and pass it to `generate --config`.
- `--overrides <file>` applies schema overrides before reporting.

### `generate [file]`

Generates data and writes it to `--out-dir` (default `dataghost-output`).

- With a **file**: inspects it and runs the chosen `--mode`:
  - `synthetic` (default) generates new records shaped like the source.
  - `mask` keeps the source and replaces fields detected as sensitive.
  - `preserve` keeps keys, nesting, nulls, array lengths and formats, and replaces every value.
- With **no file**: reads `dataghost.config.json` (or `--config`) and generates the collections it defines.

Output files are named `<input>.synthetic.json`, `<input>.masked.csv` and so on; CSV and JSONL write one file per collection. Every run checks referential integrity and fails (exit code 6) rather than write broken foreign keys. The seed is printed so a random run can be reproduced.

Single-collection inputs (JSONL, CSV, or a JSON array) larger than the in-memory limit are streamed instead of loaded; relationship detection is skipped for them. Collections that take part in no relationship are streamed straight to disk when generating, so large counts do not need to fit in memory.

### `preview [file]`

Like `generate`, but prints the first few records (default 5, or `--count`) and writes nothing.

### `validate <file>`

Checks a generated file: referential integrity for configured or detected relationships, schema conformance when a config is given, and a safety scan for values that look real (non-reserved email domains, routable IPs, Luhn-valid card numbers, real key formats). Exits with 1 when anything fails. `--json` prints the full result.

### `export <file>`

Converts a dataset between JSON, JSONL and CSV: `dataghost export data.json --format jsonl`. CSV flattens nested objects to dotted columns (`address.city`) and stores arrays as JSON. Cells starting with `=`, `+`, `-` or `@` that could run as spreadsheet formulas are prefixed with `'`.

### `generators`

Lists every generator with its category and description. See the [generator reference](generators.md).

## Options

| Option | Description |
|---|---|
| `-c, --config <file>` | Config file. Default: `./dataghost.config.json` when no input file is given. |
| `-n, --count <n \| name=n>` | Records to generate. A plain number sets the largest collection and scales the others proportionally; repeat `name=n` for exact per-collection counts. |
| `-f, --format <fmt>` | `json`, `jsonl` or `csv`. |
| `-o, --out-dir <dir>` | Output directory (default `dataghost-output`). Must be inside the current directory unless `--allow-outside-cwd`. |
| `-s, --seed <seed>` | Seed for reproducible output (number or string). |
| `-m, --mode <mode>` | `synthetic`, `mask` or `preserve`. |
| `--overrides <file>` | JSON file of schema overrides: `{"collection": {"path": spec}}`. |
| `--relationships <file>` | JSON file with an array of relationships (replaces detected ones). |
| `--force` | Overwrite existing output files. Input files are never overwritten. |
| `--allow-outside-cwd` | Allow an output directory outside the current directory. |
| `--max-input-mb <n>` | In-memory input limit (default 100). |
| `--json` | Machine-readable output (`inspect`, `validate`). |
| `-q, --quiet` | Only print errors. |

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Success |
| 1 | Validation failed |
| 2 | Usage error (unknown option, missing argument) |
| 3 | Input error (missing, unreadable or unparseable file) |
| 4 | Output error (file exists, unsafe path) |
| 5 | Config or schema error |
| 6 | Generation error (for example an impossible relationship or uniqueness constraint) |
| 70 | Internal error |

## Config file

```json
{
  "seed": 12345,
  "mode": "synthetic",
  "output": { "dir": "dataghost-output", "format": "json", "pretty": true },
  "collections": {
    "departments": { "count": 5, "schema": { "departmentId": { "type": "sequence", "prefix": "DEPT-", "pad": 2 }, "name": "department" } },
    "employees": { "count": 50, "schema": { "employeeId": "employeeId", "email": "email", "departmentId": "string" } }
  },
  "relationships": [{ "from": "employees.departmentId", "to": "departments.departmentId" }]
}
```

Other keys: `referenceDate` (the "now" for relative dates, default `2026-01-01T00:00:00Z`), `overrides`, `transformations` (`{"collection.path": "redact"}`), `keep` (paths to keep in preserve mode), `detectRelationships`, and `limits.maxInputMB`. Unknown keys are rejected. Config files are JSON only and can never contain code.
