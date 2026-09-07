// Ported from Recipe Page.dc.html's ingredient card grid (`sc-for list="{{ ingredients }}"`).
// The source's per-item derivation (Component.renderVals(), ING.map(...)) is transliterated
// here: chipBg is a constant, not per-item data; quantities are scaled at render time from the
// raw stored value, never pre-scaled in the database (D-23).
export interface IngredientRow {
  id: string;
  name: string;
  quantity: string; // Drizzle's `numeric` column returns a string to avoid float precision loss.
  unit: string;
}

interface IngredientsGridProps {
  ingredients: IngredientRow[];
  multiplier: number;
  accent: string;
}

// Source: `round(n) { return n >= 20 ? Math.round(n / 5) * 5 : Math.round(n * 2) / 2; }`
function round(n: number): number {
  return n >= 20 ? Math.round(n / 5) * 5 : Math.round(n * 2) / 2;
}

// Source: the cloves case keeps its unit word; an empty unit renders the number alone; every
// other row renders number then unit. The cloves branch is written out separately in the
// source even though it produces the same shape as the generic "has a unit" branch — kept as
// two branches here to transliterate the source 1:1 rather than collapse it.
function formatQuantity(rawQuantity: string, unit: string, multiplier: number): string {
  const scaled = round(parseFloat(rawQuantity) * multiplier);
  if (unit === "cloves") {
    return `${scaled} cloves`;
  }
  return unit ? `${scaled} ${unit}` : String(scaled);
}

export default function IngredientsGrid({ ingredients, multiplier, accent }: IngredientsGridProps) {
  return (
    <div className="rp-ing-grid">
      {ingredients.map((ing) => (
        <div key={ing.id} className="rp-ing-card">
          <div className="rp-ing-chip" style={{ color: accent }}>
            {ing.name.charAt(0)}
          </div>
          <div className="rp-ing-name">{ing.name}</div>
          <div className="rp-ing-qty">{formatQuantity(ing.quantity, ing.unit, multiplier)}</div>
        </div>
      ))}
    </div>
  );
}
