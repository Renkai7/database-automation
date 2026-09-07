import { redirect } from "next/navigation";

// Entry route: redirects to the seeded recipe so `pnpm dev` (and the smoke test's production
// server) lands somewhere useful. The three unported screens (Kitchen Home, Meal Planner,
// Recipe Builder) stay as design files in this phase (D-07), so there is no home screen to
// redirect to instead.
export default function Home() {
  redirect("/recipes/chicken-rice-bowl");
}
