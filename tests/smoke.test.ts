// D-08's automated, scriptable, headless boot proof — built to be reused verbatim by
// Phase 4's RUN-07 and Phase 5's CI-01. This performs a real production build and a real
// HTTP request against a real `next start` process; it does not import the page component
// or render it in-process.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execa, type ResultPromise } from "execa";

const PORT = 3210;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const SEEDED_URL = `${BASE_URL}/recipes/chicken-rice-bowl`;

let serverProcess: ResultPromise;

async function waitForReady(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      // Any response at all (200, 404, ...) means the server is up and routing requests.
      if (response.status) {
        return;
      }
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(
    `Server at ${url} did not become ready within ${timeoutMs}ms. Last error: ${String(lastError)}`,
  );
}

beforeAll(async () => {
  await execa("pnpm", ["--filter", "recipe-app", "build"], { stdio: "inherit" });

  serverProcess = execa("pnpm", ["--filter", "recipe-app", "start", "-p", String(PORT)], {
    stdio: "inherit",
    reject: false,
  });

  await waitForReady(SEEDED_URL, 60000);
}, 180000);

afterAll(async () => {
  if (!serverProcess) return;

  const pid = serverProcess.pid;
  if (process.platform === "win32" && pid) {
    // `pnpm --filter recipe-app start` runs the `start` script through a nested shell,
    // which itself spawns the actual `next-server` process as a grandchild. Killing only
    // the top-level pnpm process does not terminate that grandchild on Windows (there is
    // no POSIX process-group SIGTERM cascade), leaving an orphaned server holding the
    // port for any later run of this same test (or its Phase 4/5 reuse) to collide with.
    // `taskkill /T` kills the whole process tree.
    await execa("taskkill", ["/pid", String(pid), "/T", "/F"], { reject: false });
  } else {
    serverProcess.kill();
  }

  // Wait for the process to actually exit so the port is released before the next test
  // file (or a re-run) tries to bind it again.
  try {
    await serverProcess;
  } catch {
    // A killed process rejects with a non-zero/signal exit — expected here.
  }
});

// The design's own ING/STEPS content (Recipe Page.dc.html, transcribed into
// apps/recipe-app/src/db/seed.ts) — asserted against the HTTP response body, never by
// importing and rendering the components in-process, so this file stays a real boot proof
// reusable verbatim by Phase 4's RUN-07 and Phase 5's CI-01.
const SEEDED_INGREDIENT_NAMES = [
  "Chicken breast",
  "Basmati rice",
  "Broccoli",
  "Spring onions",
  "Garlic",
  "Ginger",
  "Soy sauce",
  "Sesame oil",
];

const SEEDED_STEP_BODIES = [
  "Rinse the rice until the water runs clear, then set it on with a lid down.",
  "Butterfly the chicken so it cooks evenly, and salt it while the pan comes up to heat.",
  "Sear hard on both sides until the crust is deep gold, then rest it off the heat.",
  "Steam the broccoli over the rice for the last few minutes so it stays bright.",
  "Slice the chicken, build the bowl, and dress it with the soy, sesame, garlic and ginger.",
];

describe("recipe app smoke test", () => {
  it("returns 200 with database-sourced content for the seeded slug", async () => {
    const response = await fetch(SEEDED_URL);
    expect(response.status).toBe(200);

    const body = await response.text();
    // Assert on substrings rather than the full title: the ampersand is HTML-escaped in
    // the rendered output.
    expect(body).toContain("Rice Bowl");
    expect(body).toContain("Weeknight dinner");
  });

  it("renders all eight seeded ingredients, all five seeded steps, both tabs, the CTA label and the two-servings caption", async () => {
    const response = await fetch(SEEDED_URL);
    expect(response.status).toBe(200);
    const body = await response.text();

    for (const name of SEEDED_INGREDIENT_NAMES) {
      expect(body).toContain(name);
    }
    for (const stepBody of SEEDED_STEP_BODIES) {
      expect(body).toContain(stepBody);
    }
    expect(body).toContain("Ingredients");
    expect(body).toContain("Instructions");
    expect(body).toContain("Mark as cooked");
    expect(body).toContain("Scaled for 2");
  });

  it("renders no image element for the seeded slug", async () => {
    const response = await fetch(SEEDED_URL);
    const body = await response.text();
    expect(body).not.toMatch(/<img[\s>]/);
  });

  it("returns 404 with the not-found heading for an unseeded slug", async () => {
    const response = await fetch(`${BASE_URL}/recipes/does-not-exist`);
    expect(response.status).toBe(404);

    const body = await response.text();
    expect(body).toContain("Recipe not found");
  });
});
