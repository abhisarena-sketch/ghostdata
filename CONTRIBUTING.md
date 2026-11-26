# Contributing to DataGhost

Thanks for helping. Bug reports, generators, docs and fixes are all welcome.

## Setup

```bash
git clone https://github.com/abhisarena-sketch/ghostdata.git
cd ghostdata
npm ci
npm run build
```

Node.js 20 or later is required (`.nvmrc`).

## Before opening a pull request

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

CI runs the same steps plus `npm audit` on Node.js 20 and 22.

## Guidelines

- **Fixtures must be entirely fictional.** Never commit real personal data, even "public" data. Use reserved domains (`example.com`), fictional phone ranges (555-01xx) and documentation IPs (192.0.2.x).
- **Keep it local.** No network calls, telemetry or external services in any package or the playground.
- **No dynamic code execution.** `eval`, `new Function` and similar are banned by lint.
- **Never log source values.** Errors and reports may include paths and line numbers, not data.
- **Determinism matters.** If a change alters generated values for the same seed and inputs, bump `GENERATOR_VERSION` in `packages/generators/src/registry.ts` and note it in the changelog.
- **Add tests** for new behaviour. A feature is complete only when it is implemented and tested.
- **Benchmarks:** publish only numbers you measured with `npm run bench`.
- After changing generators, regenerate the reference with `npm run build:packages && node scripts/generators-doc.mjs`.

## Adding a generator

1. Add a definition to `packages/generators/src/builtins.ts` with a zod options schema, a description and an output type.
2. Use only `ctx.rng` for randomness.
3. Make sure values cannot be real identities or credentials.
4. Add tests in `packages/generators/test`.

## Commit and PR style

Small, focused pull requests with a clear description of what changed and why. By contributing you agree that your contributions are licensed under the MIT License and that you follow the [Code of Conduct](CODE_OF_CONDUCT.md).
