# Claude Design import — provenance

**Source project:** "Meal & Workout Planning App"
`https://claude.ai/design/p/6e2325a8-3ec6-4d5b-9941-61b45ce522bd`
**Imported:** 2026-09-06 via the DesignSync tool (after /design-login)
**Design system:** Modernist — Archivo, accent #ec3013 on #f3f2f2 ground, zero corner
radius, 2px rules, grayscale photography.

The design is imported **as-is**. Do not restyle it. Per decision D13, the UI is taken
verbatim and backend functionality stays thin.

## Files

| File | Retrieval |
|---|---|
| `Kitchen Home.dc.html` | byte-exact (decoded from persisted tool output) |
| `support.js` | byte-exact (decoded from persisted tool output) |
| `image-slot.js` | byte-exact (decoded from persisted tool output) |
| `Meal Planner.dc.html` | transcribed |
| `Recipe Builder.dc.html` | transcribed |
| `Recipe Page.dc.html` | transcribed |
| `_ds/.../styles.css` | transcribed |
| `_ds/.../readme.md` | transcribed |
| `_ds/.../_ds_manifest.json` | transcribed |
| `_ds/.../_adherence.oxlintrc.json` | transcribed |
| `_ds/.../_ds_bundle.js` | transcribed |
| `ios-frame.jsx` | transcribed |

"Transcribed" means the content passed through the model context rather than being decoded
straight to disk. Verified after writing: both JSON files parse, every screen closes its
tags, and every referenced local asset resolves. That is not proof of byte-identity — if a
rendering discrepancy ever appears, re-fetch that file from the source project before
debugging it as a styling bug.

## Not imported

- `uploads/pasted-1788186636811-0.png` (4800×3600) — **exceeds the 256 KiB `get_file`
  cap and came back truncated**, so it was deleted rather than committed corrupt. No
  imported file references it; it appears to be a reference image pasted into the canvas.
  Fetch it directly from the design project if it is ever needed.
- `.thumbnail` — canvas metadata, not part of the design.

## Screens

| Screen | Contains |
|---|---|
| `Kitchen Home.dc.html` | Recipe list home, and the loop into the builder |
| `Meal Planner.dc.html` | Week ledger, recipe library, detail, shopping, settings; phone + 7-column desktop |
| `Recipe Builder.dc.html` | New-recipe form with live preview; phone + desktop |
| `Recipe Page.dc.html` | Recipe detail with ingredient/instruction tabs and a servings scaler; phone, tablet, desktop |

## What this tells the schema

The screens imply the shape of the Phase 1 schema far better than invented tables would:
recipes with name, subtitle, time, effort, servings, kcal and macros; ingredients with
name/quantity/unit and metric-imperial-cups variants; ordered steps with optional timers;
tags; usage tracking ("used 14×, last 24 Aug"); and — beyond the recipe core — meal-plan
days, meal slots with planned/done/skipped status, and shopping items grouped by aisle.

Note the design's own scope: it is a **meal and workout planner**, wider than "recipe app".
Phase 1 needs only enough schema for the app to boot; the rest is churn material for later
phases. Do not build the whole data model up front.

## Note on the design's internals

The `.dc.html` files are Claude Design canvas documents, not plain pages: `<x-dc>`,
`<sc-if>`, `<sc-for>`, `{{ }}` bindings and a `DCLogic` component class, all driven by
`support.js`. Converting them to the Node/TypeScript stack means porting that binding model
to real components — the CSS and design tokens carry over unchanged, which is what keeps the
styling identical.

`Recipe Page.dc.html` deliberately departs from Modernist (rounded corners, warmer palette)
and its own notes say so. That divergence is intentional; keep it.
