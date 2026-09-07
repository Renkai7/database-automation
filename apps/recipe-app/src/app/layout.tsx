import type { ReactNode } from "react";

// Minimal root layout. Fonts and design tokens are wired by plan 01-05 — deliberately not
// added here.
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
