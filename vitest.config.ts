import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["scripts/**/*.test.ts", "tests/**/*.test.ts", "apps/**/*.test.ts"],
    testTimeout: 180000,
    hookTimeout: 180000,
    pool: "forks",
    fileParallelism: false,
  },
});
