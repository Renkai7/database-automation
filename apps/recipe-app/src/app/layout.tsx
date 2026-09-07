import type { ReactNode } from "react";
import { Archivo } from "next/font/google";
import "./globals.css";

// Same three weights the source imports (_ds/.../styles.css line 2:
// `Archivo:wght@400;600;800`) via next/font/google instead of a render-blocking @import.
const archivo = Archivo({
  subsets: ["latin"],
  weight: ["400", "600", "800"],
  variable: "--font-archivo",
});

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={archivo.variable}>
      <body>{children}</body>
    </html>
  );
}
