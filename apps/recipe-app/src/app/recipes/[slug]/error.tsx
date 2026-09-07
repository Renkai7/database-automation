"use client";

// Route-level error boundary. Net-new markup, standard 8pt scale + base body style (same
// regime as not-found.tsx), per UI-SPEC's resolved Open Question 1. This deliberately does
// NOT render `error.message` or `error.stack` — either can carry connection details (T-01-21,
// threat_model) — and does not log the error object at all, so no path here can ever emit a
// connection string. `error` is accepted (required by Next's error boundary contract) but is
// otherwise unused by design.
export default function RecipeError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="std-page">
      <h1 className="std-heading">Could not load this recipe</h1>
      <p className="std-body">
        The database did not answer. This is a local development environment, so the container
        may not be running.
      </p>
      <button type="button" className="std-button" onClick={reset}>
        Try again
      </button>
    </main>
  );
}
