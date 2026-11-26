# Releasing

The packages are **prepared but not published**. Publishing is a manual step for a maintainer.

## Package names

Checked against the npm registry on 2026-11-26. None of these names were taken (each returned 404):

| Package | Status |
|---|---|
| `@workfonic/dataghost` | available |
| `@workfonic/dataghost-cli` | available |
| `@workfonic/dataghost-generators` | available |
| `@workfonic/dataghost-relationships` | available |
| `@workfonic/dataghost-privacy` | available |

Scoped names need the `workfonic` organisation on npm. The registry search found no packages under that scope, so create the organisation (or confirm you own it) before the first publish. The unscoped name `dataghost` was also free.

## Checklist

1. `npm ci && npm run typecheck && npm run lint && npm test && npm run build && npm audit`
2. Update versions in every `packages/*/package.json` and the internal dependency ranges together.
3. Move the `Unreleased` changelog section under the new version and date. If generated values changed, confirm `GENERATOR_VERSION` was bumped.
4. Inspect each tarball: `npm pack --dry-run -w packages/<name>`. It should contain only `dist`, `README.md`, `LICENSE` and `package.json`.
5. Publish in dependency order, with provenance from CI if possible:
   ```bash
   for p in generators relationships privacy core cli; do npm publish -w packages/$p --access public; done
   ```
6. Tag the release (`v0.1.0`) and create a GitHub release with the changelog section.

The playground (`apps/playground`) is private and is never published to npm. Its static build (`apps/playground/out`) can be hosted on any static host.
