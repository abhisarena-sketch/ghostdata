# Installation

DataGhost needs **Node.js 20 or later**. It has no native dependencies and makes no network calls at run time.

## From npm (once published)

```bash
npm install --save-dev @workfonic/dataghost-cli   # the `dataghost` command
npm install @workfonic/dataghost                  # the SDK
```

The packages are prepared for publishing but have **not been published yet**. See [releasing](releasing.md).

## From source

```bash
git clone https://github.com/abhisarena-sketch/ghostdata.git
cd ghostdata
npm ci
npm run build            # packages and the playground
node packages/cli/dist/bin.js --help
```

To use the CLI from anywhere during development, run `npm link -w @workfonic/dataghost-cli`.

## Playground

```bash
npm run dev              # builds the packages, then starts the playground on http://localhost:3000
```

`npm run build` writes a static export to `apps/playground/out`. Serve it with any static file server. It needs no backend.

## Supported platforms

DataGhost is tested in CI on Linux with Node.js 20 and 22. It uses only portable Node.js APIs and should work on macOS and Windows. Please report problems.
