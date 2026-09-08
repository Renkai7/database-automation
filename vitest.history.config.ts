import { defineConfig } from "vitest/config";

// D-24 (04-CONTEXT.md): the separate, slow entry point for the Docker-dependent migration-history
// proof (`pnpm test:history`) -- the second slow suite alongside vitest.drill.config.ts's restore
// drill. include is exactly tests/history/ -- the mirror image of vitest.config.ts's exclude --
// so a fast test placed anywhere else can never accidentally land here, and this file cannot
// silently grow to cover more than that one directory. Timeouts, pool, and single-file-parallelism
// match vitest.drill.config.ts and vitest.config.ts exactly; only the glob differs.
export default defineConfig({
  test: {
    include: ["tests/history/**/*.test.ts"],
    testTimeout: 180000,
    hookTimeout: 180000,
    pool: "forks",
    fileParallelism: false,
  },
});
