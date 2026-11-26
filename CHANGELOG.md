# Changelog

All notable changes are listed here. This project follows [Semantic Versioning](https://semver.org/).

Generated output is deterministic for a given seed, input, options, reference date and **generator version**. Any change that alters generated values for the same inputs bumps `GENERATOR_VERSION` and is called out under "Determinism" below.

## [0.1.0] - Unreleased

First release.

### Added

- Schema inference for JSON, JSONL and CSV: types, semantic types with confidence, nullability, structural examples, suggested generators, privacy classification, overrides, and multi-collection inference with relationship detection.
- 57 seeded generators across personal, professional, technical, numeric, temporal, text and custom categories, all producing fictional or reserved-range values.
- Relationship engine: one-to-one, one-to-many, many-to-one, nested and self-referencing foreign keys, dependency ordering, cycle detection, deferred edges, and integrity validation after every run.
- Privacy: sensitive-field detection with uncertainty warnings, seven transformations, consistent collision-free pseudonymisation, and a safety scan for real-looking values.
- Modes: synthetic, mask and preserve.
- SDK (`@workfonic/dataghost`) with the `DataGhost` class.
- CLI (`dataghost`): `init`, `inspect`, `generate`, `preview`, `validate`, `export`, `generators`, with streaming for large inputs and safe output handling.
- Browser playground (Next.js static export) running the engine locally.
- Benchmarks at 1k, 10k and 100k records.

### Determinism

- Generator version `1.0.0`. Default reference date `2026-01-01T00:00:00Z`.
