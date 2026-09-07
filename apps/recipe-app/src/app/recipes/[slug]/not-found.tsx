import Link from "next/link";

// Net-new markup with no design-file analog (01-PATTERNS.md "Error/not-found handling"): the
// standard 8pt spacing scale and the base 15px/1.55 Archivo body style apply here, NOT the
// Recipe Page's non-4px exception values — the two spacing regimes are deliberately separate.
// The design supplies no copy for this state (UI-SPEC Copywriting Contract), so it is written
// here.
export default function RecipeNotFound() {
  return (
    <main className="std-page">
      <h1 className="std-heading">Recipe not found</h1>
      <p className="std-body">No recipe matches that address. It may have been renamed.</p>
      <Link href="/" className="std-link">
        Back to the kitchen
      </Link>
    </main>
  );
}
