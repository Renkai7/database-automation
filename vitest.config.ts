import { configDefaults, defineConfig } from "vitest/config";

// D-16 (02-CONTEXT.md): tests/drill/ holds the slow, Docker-dependent end-to-end drill proof
// (see vitest.drill.config.ts). Excluded here on top of vitest's own default exclude list, not
// in place of it, so a slow test placed in that directory cannot join this default suite even if
// someone forgets -- structural, not conventional.
export default defineConfig({
  test: {
    include: ["scripts/**/*.test.ts", "tests/**/*.test.ts", "apps/**/*.test.ts", "packages/**/*.test.ts"],
    exclude: [...configDefaults.exclude, "tests/drill/**"],
    testTimeout: 180000,
    hookTimeout: 180000,
    pool: "forks",
    fileParallelism: false,
  },
});
