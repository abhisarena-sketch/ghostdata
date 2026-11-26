# Privacy and security guide

DataGhost helps you avoid putting real identities into test environments. It is a tool, not a guarantee. This page explains what it does, what it does not do, and how it protects your data while it runs.

## Detection is not protection

`inspect` classifies each field into a category (person name, email, phone, address, date of birth, government ID, card number, IP address, password, auth token, API key, free text, quasi-identifier or identifier) and a level: `none`, `low`, `medium`, `high` or `secret`. It uses field names, value patterns and context such as the parent object.

- **Detection is heuristic.** It can miss sensitive fields (for example personal data in a field called `notes2`) and can flag harmless ones.
- Detections below 70% confidence are marked **uncertain** and listed as warnings. Review them.
- No detection does not mean no personal data.

## The three modes

| Mode | What it does | What it does not do |
|---|---|---|
| `synthetic` | Generates new records from the inferred schema. No source values are copied, except that enum values and numeric ranges are learned from the source. | Synthetic data is not automatically anonymous: if a source enum contains names, so will the output. Review enums. |
| `mask` | Replaces fields detected as sensitive and keeps everything else. | Undetected personal data passes through unchanged. Remaining fields and combinations of quasi-identifiers (postal code, birth date, gender) can still re-identify people. **Masking does not guarantee anonymisation.** |
| `preserve` | Keeps keys, nesting, nulls, array lengths and formats, and replaces every value. | Structure itself (which fields are null, array lengths) is kept and can carry information. |

## Transformations

`keep`, `redact` (`[REDACTED]`), `pseudonymize` (consistent replacement: the same input gives the same output within a run, and identifiers and emails never collide), `format-preserve` (same shape, new characters), `synthesize` (a new realistic value of the same kind), `generalize` (coarser: a birth year instead of a date, a postal-code prefix), and `null`.

- **Credentials are always redacted.** Passwords, tokens, API keys and private keys are never copied, even if you configure `keep`.
- Card numbers become values that start with `0000` and fail the Luhn check. Government IDs become never-issued shapes (`000-xx-xxxx`). Phones move to fictional ranges, IPs to documentation ranges and emails to reserved domains.
- **Seeded masking is reproducible.** Anyone with the seed and candidate inputs could test guesses. Leave the seed unset (a random secret is used) when masked output leaves your team.

## Generated data is safe by construction

Emails and URLs use RFC 2606 reserved domains (`example.com`, `*.test`...). Phone numbers use the US 555-0100..0199 and UK 07700 900xxx fictional ranges. IP addresses use RFC 5737 and RFC 3849 documentation ranges. Card numbers fail the Luhn check, government IDs use never-issued prefixes, and secrets look like `dg_test_<hex>`. `validate` runs a safety scan that flags values which look real: non-reserved email domains, routable IPs, Luhn-valid card numbers and real key formats.

## How DataGhost handles your data

- **Local only.** The CLI, SDK and playground process data on your machine. There are no uploads, no external services and no telemetry. The playground's production build sets a content security policy that blocks connections to other origins, and Next.js telemetry is disabled in its scripts.
- **No code execution from data or config.** There is no `eval` or `Function` (enforced by lint). Config files are validated JSON. Custom generators are plain functions in the SDK only, and the playground never accepts code. The `pattern` generator accepts a safe regex subset with bounded repetition.
- **No logging of source contents.** Inspection examples are structural (`Xxxx-999`, `<email>`) and never show source values. Parse errors report a line number, not the text.
- **Safe file handling.** CLI outputs must be inside the current directory unless `--allow-outside-cwd`. Existing files are not overwritten without `--force`, input files are never overwritten, and file names derived from collection names are sanitised against path traversal. Outputs are written to a temporary file and renamed, so a failed run leaves no partial file.
- **Input limits.** The CLI loads up to 100 MB in memory by default (`--max-input-mb`) and streams larger single-collection files. The playground accepts files up to 10 MB. Prototype-polluting keys (`__proto__`, `constructor`, `prototype`) are dropped from CSV headers and rejected in paths.
- **No ZIP import.** Archives are not supported, which avoids zip-bomb and path-traversal risks.

## Before you share output

1. Review every field in `inspect`, especially uncertain ones and free text.
2. Prefer `synthetic` or `preserve` over `mask` for data that leaves your team.
3. Generalise or replace quasi-identifiers.
4. Run `dataghost validate` and read the safety scan.
5. Follow your organisation's data-protection rules. DataGhost does not replace a privacy review.

To report a vulnerability, see [SECURITY.md](../SECURITY.md).
