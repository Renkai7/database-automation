import { notFound } from "next/navigation";
import { db } from "@/db/client";

// Next.js 16 removed the Next 15 synchronous-params compatibility shim entirely, so params
// is typed as a Promise and must be awaited — reading it synchronously here would be a
// runtime bug in a fresh Next 16 project today, not a deprecation warning.
export const dynamic = "force-dynamic";

export default async function RecipePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const recipe = await db.query.recipes.findFirst({
    where: (recipes, { eq }) => eq(recipes.slug, slug),
  });

  if (!recipe) {
    notFound();
  }

  // The designed screen is ported in plan 01-05; this route renders real database content,
  // not placeholder content.
  return (
    <main>
      <h1>{recipe.title}</h1>
      <p>{recipe.subtitle}</p>
    </main>
  );
}
