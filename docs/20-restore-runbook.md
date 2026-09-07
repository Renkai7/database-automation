# Restore Runbook

**Status:** Performed by hand on 2026-09-07. Both acts succeeded. Read `What actually
happened` before trusting the procedure below blindly — it is written from a single
real run, and that run had gaps.

## Before you run anything — read this

The timings in this document come from a **single-recipe fixture database**: 1 recipe,
8 ingredients, 5 steps, a roughly 9 KB custom-format dump, on a developer laptop. They
are **not a production recovery-time estimate.** Production RTO (recovery time
objective) is **UNKNOWN** — it has never been measured against anything resembling a
real production data volume. Do not let "this took a few minutes" quietly become a
planning assumption about production.

- **Total time, first time performing this drill** (includes reading, deciding, and
  looking things up): **about 3-4 minutes**, per the owner's own report.
- **Time if only copy-pasting the commands** (no first-time reading/deciding overhead):
  **about 1-2 minutes**, per the owner's own report.
- **Per-step timings** (backup, drop, restore, verify — for either act) were **NOT
  SEPARATELY MEASURED** during this drill. This is itself a finding about the procedure,
  not an omission from this document: the run did not clock individual steps, only a
  start-to-finish sense of duration. Do not treat any per-step number you see elsewhere
  as coming from this drill.
- **Human reading-and-deciding time** is given its own line because it is the part that
  does not shrink with data volume and usually dominates a real incident. It was not
  clocked directly. It is **inferred** — not measured — from the roughly two-minute gap
  between the "first time" framing and the "just copy/pasting" framing above, which is
  the owner's own characterization of the first-time overhead. Treat it as a rough,
  self-reported impression, not a stopwatch number.

## Operational notes

- The backup destination below is referred to by its variable name,
  `RECIPE_BACKUP_DESTINATION`, never as a literal path — see `scripts/env.ts` /
  `docs/00-current-state.md`.
- Backups accumulate at the destination as timestamped artifacts. Nothing prunes them
  automatically. Retention/cleanup is not built yet — living with a growing directory of
  dumps is the current, accepted behavior, not an oversight to silently work around.

---

## Act 1 — drop a real table, restore it in place

Prerequisites: the environment is reset and seeded (`pnpm db:reset`), the automated
drill is green (`pnpm db:drill`), and a fresh backup has been taken (`pnpm db:backup`).

1. Note the baseline row counts:
   ```
   pnpm db:query "SELECT (SELECT count(*) FROM recipes) AS recipes, (SELECT count(*) FROM ingredients) AS ingredients, (SELECT count(*) FROM steps) AS steps;"
   ```
2. Destroy real data:
   ```
   docker compose exec -T db psql -U recipe_app -d recipe_dev -c "DROP TABLE recipes CASCADE;"
   ```
   `recipes` is the parent table; `ingredients` and `steps` both reference it, so this
   also removes their foreign keys.
3. Confirm the damage is real before restoring:
   ```
   pnpm db:query "SELECT (SELECT count(*) FROM recipes) AS recipes, (SELECT count(*) FROM ingredients) AS ingredients, (SELECT count(*) FROM steps) AS steps;"
   ```
   — errors with `relation "recipes" does not exist`.
   ```
   docker compose exec -T db psql -U recipe_app -d recipe_dev -c "SELECT conname FROM pg_constraint WHERE contype='f';"
   ```
   — returns **0 rows**.
4. Restore:
   ```
   pnpm db:restore
   ```
5. Confirm the data returned, two ways:
   - Compare row counts and a spot-checked recognisable value against the backup
     manifest:
     ```
     pnpm db:query "SELECT slug, title, base_servings, base_kcal FROM recipes;"
     ```
   - Run `pnpm dev` and open the recipe page in a browser — see the seeded recipe render
     with its ingredients and steps.
6. Re-run the foreign-key query from step 3 and confirm the constraints came back:
   ```
   docker compose exec -T db psql -U recipe_app -d recipe_dev -c "SELECT conname FROM pg_constraint WHERE contype='f';"
   ```

## Act 2 — total loss, restored into a rebuilt cluster

7. Destroy the container **and its volume**:
   ```
   docker compose down -v
   ```
8. Bring up an empty cluster:
   ```
   docker compose up -d --wait
   ```
9. Restore from both dumps:
   ```
   pnpm db:restore:cluster
   ```
   Read its final lines carefully — see "What actually happened" below for a wrinkle in
   where the verdict actually prints.
10. Confirm again the same two ways as step 5.

---

## What actually happened

This section exists because a runbook with no surprises in it reads exactly like one
written from documentation instead of from a real run. Everything below came from the
owner's actual pass through the drill, not from what the tooling was designed to do.

### A wrong turn: no foreign-key baseline before the drop

The procedure above (as run) did **not** ask for a foreign-key baseline before Act 1's
`DROP TABLE`. The owner captured row counts first, but not the constraint names. After
the drop, the foreign-key query correctly showed 0 rows — but there was no way to tell
from that alone *which* constraints had just been lost. The names
(`ingredients_recipe_id_recipes_id_fk`, `steps_recipe_id_recipes_id_fk`) had to be
reconstructed afterwards from `apps/recipe-app/drizzle/0001_busy_thunderbolt.sql`.

This worked because the migration history was available. **In a real incident where the
repository itself was also unavailable, this reconstruction would not have been
possible.** Step 1 above has been left as originally written (row counts only) because
that is what was actually run; a future revision of this procedure should consider
capturing the constraint list as part of the baseline, not just row counts.

### A plan prediction that did not hold — recorded honestly

This phase's plan (`02-05-PLAN.md`) asserted, as one of its `must_haves`: *"The runbook
records the `DROP TABLE recipes CASCADE` constraint gap — that the rows come back and
the foreign keys do not, and that only the schema comparison notices."*

**That did not happen in this run.** After `pnpm db:restore`, the foreign-key query
returned exactly:

```
ingredients_recipe_id_recipes_id_fk
steps_recipe_id_recipes_id_fk
```

Both foreign keys came back. The predicted constraint gap **does not exist** on this
restore path.

The likely explanation (recorded as a probable reason, **not** a verified fact): the
plan appears to have been written expecting a table-scoped restore of `recipes` alone,
in which case constraints living on `ingredients`/`steps` would indeed stay dropped.
`pnpm db:restore`, as actually implemented in plan 02-03, is a **full-database restore**
with `--clean --if-exists` — so the dump's complete schema, constraints included,
returns along with the data. The empirical result overrides the planning assumption.

**Why this matters for a future reader:** anyone trusting the plan's original prediction
would draw the wrong conclusion about what `pnpm db:restore` guarantees. It does not
leave a constraint gap for a whole-database restore of this kind. A narrower,
table-scoped restore might still exhibit the originally-predicted gap — that was not
tested here.

### Act 2's globals verdict: NOT EXERCISED

`docker compose down -v`, `docker compose up -d --wait`, and `pnpm db:restore:cluster`
all completed. The printed verdict, verbatim from the owner's terminal:

> "The globals path is exercised strictly by pnpm db:drill, whose disposable container
> bootstraps under a non-colliding identity."

In full, the script printed:

> `globals restore: NOT EXERCISED -- the container entrypoint already created role
> "recipe_app" from POSTGRES_USER, so this cluster is not role-empty. The globals path
> is exercised strictly by pnpm db:drill, whose disposable container bootstraps under a
> non-colliding identity.`

Meaning: the `postgres:17` container's own entrypoint had already created the
`recipe_app` role from `POSTGRES_USER` before the script ran, so the globals restore
step was a no-op.

**Consequence, recorded plainly:** `pnpm db:restore:cluster` does **not** prove the
roles are recoverable — on this machine, it never exercises that code path at all. Only
`pnpm db:drill` (the automated drill's disposable, non-colliding container) does. If the
cluster is ever rebuilt somewhere the entrypoint has **not** pre-created the role, that
will be the **first time** the globals restore genuinely runs, and it will be untested
at exactly that moment. This is a real, currently open risk — not a resolved one.

### Minor defect found during the drill

`scripts/restore-cluster.ts`'s comment above its final `console.log` calls says the
globals verdict is "Printed again as the final line of output," but
`console.log("[db:restore:cluster] Complete.")` runs immediately after it — so the
verdict is actually the **second-to-last** line, not the last. The owner looked at the
last line first while timing the exercise and did not find the verdict there, costing a
round trip. This file is not in this plan's own `files_modified`, so the comment was not
edited here; it is recorded in `.planning/WINDOWS.md` instead.

### Data recovery — both acts

Both acts fully recovered the data. In both cases the recipe page rendered correctly in
the UI after restore, with the seeded recipe, its ingredients, and its steps visible.

### Owner's overall verdict

> "Nothing too complicated about this it seems."

**The restore worked.** Both acts succeeded.
