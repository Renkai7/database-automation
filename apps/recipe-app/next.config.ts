import path from "node:path";
import type { NextConfig } from "next";

// `next build`/`next start` run with this package's directory as cwd (pnpm --filter
// recipe-app runs scripts from apps/recipe-app). The file tracer must follow the relative
// import from src/db/client.ts into the shared ../../../../scripts/env.ts module, which
// lives outside this app's own directory — outputFileTracingRoot must therefore point at
// the workspace root (two levels up: apps/recipe-app -> apps -> root).
const workspaceRoot = path.resolve(process.cwd(), "..", "..");

const nextConfig: NextConfig = {
  outputFileTracingRoot: workspaceRoot,
};

export default nextConfig;
