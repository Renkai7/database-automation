"use client";

import { useState } from "react";
import IngredientsGrid, { type IngredientRow } from "./IngredientsGrid";
import StepsList, { type StepRow } from "./StepsList";

// Recipe Page.dc.html's Component.state / renderVals() transliterated 1:1 into React state +
// a plain derived-values block (01-PATTERNS.md "Binding-model -> React mapping"). Exactly four
// pieces of state exist and none of them is written back to the database or any storage —
// favourite and cooked are ephemeral, resolved owner decision (UI-SPEC Open Question 2).
const ACCENT = "#e8623c";

interface RecipeHeaderData {
  title: string;
  subtitle: string;
  baseServings: number;
  timeLabel: string;
  effort: string;
  baseKcal: number;
}

interface RecipeScreenProps {
  recipe: RecipeHeaderData;
  ingredients: IngredientRow[];
  steps: StepRow[];
}

// Source: `round(n) { return n >= 20 ? Math.round(n / 5) * 5 : Math.round(n * 2) / 2; }`
function round(n: number): number {
  return n >= 20 ? Math.round(n / 5) * 5 : Math.round(n * 2) / 2;
}

export default function RecipeScreen({ recipe, ingredients, steps }: RecipeScreenProps) {
  const [tab, setTab] = useState<"ing" | "steps">("ing");
  const [servings, setServings] = useState(recipe.baseServings);
  const [fav, setFav] = useState(true);
  const [cooked, setCooked] = useState(false);

  const onIngredients = tab === "ing";
  const onSteps = !onIngredients;

  // Source: `mult = s.servings / 2` — the divisor is now the recipe's real base_servings
  // column rather than the source's hardcoded literal.
  const multiplier = servings / recipe.baseServings;
  const kcalLabel = `${round(recipe.baseKcal * multiplier)} kcal`;
  const servingsLabel = servings === 1 ? "Scaled for one" : `Scaled for ${servings}`;

  const inc = () => setServings((n) => Math.min(8, n + 1));
  const dec = () => setServings((n) => Math.max(1, n - 1));
  const toggleFav = () => setFav((f) => !f);
  const toggleCooked = () => setCooked((c) => !c);

  const ingFill = onIngredients ? ACCENT : "transparent";
  const ingColor = onIngredients ? "#fffaf6" : "#8d7d76";
  const ingShadow = onIngredients ? "0 4px 12px rgba(200,80,45,.28)" : "none";
  const stepFill = onIngredients ? "transparent" : ACCENT;
  const stepColor = onIngredients ? "#8d7d76" : "#fffaf6";
  const stepShadow = onIngredients ? "none" : "0 4px 12px rgba(200,80,45,.28)";

  // Hardcoded and independent of ACCENT — a change to the accent constant must not change
  // favourite-state colour (UI-SPEC Color section, must_haves).
  const favColor = fav ? "#e0362b" : "#c9b3aa";
  const favFill = fav ? "#e0362b" : "none";

  const ctaLabel = cooked ? "Cooked ✓" : "Mark as cooked";
  const ctaBg = cooked ? "#fdeee8" : ACCENT;
  const ctaColor = cooked ? "#c04a26" : "#fffaf6";

  return (
    <div className="rp-shell" style={{ background: ACCENT }}>
      <div className="rp-navbar">
        <button className="rp-icon-btn" aria-label="Back" type="button">
          <svg
            width="19"
            height="19"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M19 12H5"></path>
            <path d="m12 19-7-7 7-7"></path>
          </svg>
        </button>
        <button className="rp-icon-btn" aria-label="Save" type="button">
          <svg
            width="19"
            height="19"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path>
          </svg>
        </button>
      </div>

      <div className="rp-sheet">
        <div className="rp-sheet-inner">
          <div className="rp-body">
            <div className="rp-header">
              <div className="rp-title-block">
                <h1 className="rp-title">{recipe.title}</h1>
                <p className="rp-subtitle">{recipe.subtitle}</p>
              </div>
              <button
                className="rp-fav-btn"
                onClick={toggleFav}
                style={{ color: favColor }}
                aria-label="Toggle favourite"
                type="button"
              >
                <svg
                  width="21"
                  height="21"
                  viewBox="0 0 24 24"
                  fill={favFill}
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"></path>
                </svg>
              </button>
            </div>

            <div className="rp-meta">
              <div className="rp-meta-item">
                <svg
                  className="rp-meta-icon"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke={ACCENT}
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="12" cy="13" r="8"></circle>
                  <path d="M12 9v4l2 2"></path>
                  <path d="M5 3 2 6"></path>
                  <path d="m22 6-3-3"></path>
                </svg>
                <span>{recipe.timeLabel}</span>
              </div>
              <div className="rp-meta-item">
                <svg
                  className="rp-meta-icon"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke={ACCENT}
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="12" cy="12" r="9"></circle>
                  <path d="M8 14s1.5 2 4 2 4-2 4-2"></path>
                  <path d="M9 9h.01"></path>
                  <path d="M15 9h.01"></path>
                </svg>
                <span>{recipe.effort}</span>
              </div>
              <div className="rp-meta-item">
                <svg
                  className="rp-meta-icon"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke={ACCENT}
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M13 2 4.5 12.5a1 1 0 0 0 .8 1.6H11l-1 7.9L18.5 11a1 1 0 0 0-.8-1.6H12z"></path>
                </svg>
                <span>{kcalLabel}</span>
              </div>
              <div className="rp-meta-divider" />
              <div className="rp-servings">
                <span className="rp-servings-label">{servingsLabel}</span>
                <div className="rp-stepper">
                  <button className="rp-stepper-btn" onClick={dec} aria-label="Decrease servings" type="button">
                    −
                  </button>
                  <span className="rp-stepper-count">{servings}</span>
                  <button className="rp-stepper-btn" onClick={inc} aria-label="Increase servings" type="button">
                    +
                  </button>
                </div>
              </div>
            </div>

            <div className="rp-tabs">
              <button
                className="rp-tab"
                style={{ background: ingFill, color: ingColor, boxShadow: ingShadow }}
                onClick={() => setTab("ing")}
                type="button"
              >
                Ingredients
              </button>
              <button
                className="rp-tab"
                style={{ background: stepFill, color: stepColor, boxShadow: stepShadow }}
                onClick={() => setTab("steps")}
                type="button"
              >
                Instructions
              </button>
            </div>

            <div className="rp-panels">
              {onIngredients && (
                <IngredientsGrid ingredients={ingredients} multiplier={multiplier} accent={ACCENT} />
              )}
              {onSteps && <StepsList steps={steps} accent={ACCENT} />}
            </div>

            <div className="rp-cta-wrap">
              <button
                className="rp-cta"
                style={{ background: ctaBg, color: ctaColor }}
                onClick={toggleCooked}
                type="button"
              >
                {ctaLabel}
              </button>
              <div className="rp-home-bar" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
