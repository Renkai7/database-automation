import { defineConfig } from "vitest/config";

// D-16 (02-CONTEXT.md): the separate, slow entry point for the Docker-dependent end-to-end drill
// proof (`pnpm test:drill`). include is exactly tests/drill/ -- the mirror image of
// vitest.config.ts's exclude -- so a fast test placed anywhere else can never accidentally land
// here, and this file cannot silently grow to cover more than that one directory. Timeouts, pool,
// and single-file-parallelism match vitest.config.ts exactly; only the glob differs.
export default defineConfig({
  test: {
    include: ["tests/drill/**/*.test.ts"],
    testTimeout: 180000,
    hookTimeout: 180000,
    pool: "forks",
    fileParallelism: false,
  },
});
