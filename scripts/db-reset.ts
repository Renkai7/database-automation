// ENV-04: db:reset performs a full teardown-and-rebuild in the D-22 order — destroy the
// container and its named volume, bring up a fresh one, assert the environment, migrate the
// full history, and reseed — in one non-interactive invocation (D-24). No import of an
// interactive-prompt library and no read of stdin: the environment assertion in step 3 is
// the structural guard, not a confirmation prompt. Takes no arguments and no target
// parameter; it acts on this workspace's own compose project only.
import { execa } from "execa";
import { Client } from "pg";
import { assertDevelopmentDatabase, getDevDatabaseUrl } from "./env";
import { safeErrorMessage } from "./log";

async function waitForReadyFallback(): Promise<void> {
  // A4: fallback for a Compose build that predates the `--wait` flag — a bounded
  // pg_isready poll rather than a hand-rolled indefinite retry.
  const maxAttempts = 30;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const result = await execa(
      "docker",
      ["compose", "exec", "-T", "db", "pg_isready", "-U", "recipe_app", "-d", "recipe_dev"],
      { reject: false },
    );
    if (result.exitCode === 0) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error(
    "Timed out waiting for the database container to become ready (fallback pg_isready poll).",
  );
}

async function runStep(name: string, action: () => Promise<void>): Promise<void> {
  console.log(`[db:reset] ${name}...`);
  try {
    await action();
  } catch (error) {
    // Name the failing step explicitly; do not continue to the next one. See scripts/log.ts
    // for the never-print-the-raw-error-object rationale.
    console.error(`[db:reset] FAILED at step "${name}": ${safeErrorMessage(error)}`);
    process.exit(1);
  }
  console.log(`[db:reset] ${name} done.`);
}

async function main(): Promise<void> {
  // Step 1: destroy the container AND its named volume — every rebuild starts from
  // genuinely nothing (D-22), which is the only variant that proves the migration history
  // applies to a truly empty instance.
  await runStep("docker compose down -v", async () => {
    await execa("docker", ["compose", "down", "-v"]);
  });

  // Step 2: bring up a fresh container and wait for it to report healthy.
  await runStep("docker compose up -d --wait", async () => {
    try {
      await execa("docker", ["compose", "up", "-d", "--wait"]);
    } catch (error) {
      console.log(
        "[db:reset] `docker compose up -d --wait` failed, falling back to a pg_isready poll " +
          `(reason: ${safeErrorMessage(error)})`,
      );
      await execa("docker", ["compose", "up", "-d"]);
      await waitForReadyFallback();
    }
  });

  // Step 3: assert the environment before anything writes. This is the structural guard
  // D-24 relies on in place of an interactive confirmation prompt.
  await runStep("assert development database", async () => {
    const client = new Client({ connectionString: getDevDatabaseUrl() });
    try {
      await client.connect();
      await assertDevelopmentDatabase(client);
    } finally {
      await client.end();
    }
  });

  // Step 4: apply the full migration history through the root db:migrate target.
  await runStep("drizzle-kit migrate", async () => {
    await execa("pnpm", ["run", "db:migrate"]);
  });

  // Step 5: reseed through the root db:seed target.
  await runStep("db:seed", async () => {
    await execa("pnpm", ["run", "db:seed"]);
  });

  console.log("[db:reset] Complete.");
}

main().catch((error: unknown) => {
  // See scripts/log.ts for the never-print-the-raw-error-object rationale.
  console.error(safeErrorMessage(error));
  process.exit(1);
});
