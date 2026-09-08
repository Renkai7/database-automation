import { configDefaults, defineConfig } from "vitest/config";

// D-16 (02-CONTEXT.md), D-24 (04-CONTEXT.md): tests/drill/ holds the slow, Docker-dependent
// end-to-end restore-drill proof (see vitest.drill.config.ts); tests/history/ holds the second
// slow, Docker-dependent suite -- the migration-history proof (see vitest.history.config.ts).
// Both excluded here on top of vitest's own default exclude list, not in place of it, so a slow
// test placed in either directory cannot join this default suite even if someone forgets --
// structural, not conventional.
export default defineConfig({
  test: {
    include: ["scripts/**/*.test.ts", "tests/**/*.test.ts", "apps/**/*.test.ts", "packages/**/*.test.ts"],
    exclude: [...configDefaults.exclude, "tests/drill/**", "tests/history/**"],
    testTimeout: 180000,
    hookTimeout: 180000,
    pool: "forks",
    fileParallelism: false,
  },
});
