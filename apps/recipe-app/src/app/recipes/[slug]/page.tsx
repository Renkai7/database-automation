import { notFound } from "next/navigation";
import { db } from "@/db/client";
import RecipeScreen from "@/components/RecipeScreen";

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

  // Loads the recipe together with its ingredients and steps in one query, both children
  // ordered by their `position` column — no hardcoded ingredient/step array anywhere here.
  const recipe = await db.query.recipes.findFirst({
    where: (recipes, { eq }) => eq(recipes.slug, slug),
    with: {
      ingredients: {
        orderBy: (ingredients, { asc }) => [asc(ingredients.position)],
      },
      steps: {
        orderBy: (steps, { asc }) => [asc(steps.position)],
      },
    },
  });

  if (!recipe) {
    notFound();
  }

  return (
    <RecipeScreen
      recipe={{
        title: recipe.title,
        subtitle: recipe.subtitle,
        baseServings: recipe.baseServings,
        timeLabel: recipe.timeLabel,
        effort: recipe.effort,
        baseKcal: recipe.baseKcal,
      }}
      ingredients={recipe.ingredients}
      steps={recipe.steps}
    />
  );
}
