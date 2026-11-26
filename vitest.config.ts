import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const src = (pkg: string) => fileURLToPath(new URL(`./packages/${pkg}/src/index.ts`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@workfonic/dataghost-generators": src("generators"),
      "@workfonic/dataghost-relationships": src("relationships"),
      "@workfonic/dataghost-privacy": src("privacy"),
      "@workfonic/dataghost-cli": src("cli"),
      "@workfonic/dataghost": src("core"),
    },
  },
  test: {
    include: ["packages/*/test/**/*.test.ts", "tests/**/*.test.ts"],
    environment: "node",
    testTimeout: 60_000,
  },
});
