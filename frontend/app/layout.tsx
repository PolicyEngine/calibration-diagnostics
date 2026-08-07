import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { Providers } from "./providers";
import "./globals.css";

// The two families microcosm.institute vendors — self-hosted here via next/font so the
// dashboard renders in the same faces with no external request. Exposed as CSS
// variables that globals.css points --font-sans / --font-mono at.
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-jetbrains",
  display: "swap",
});

export const metadata: Metadata = {
  // Follows microcosm.institute's "… — microcosm" title convention (its /calibration
  // page is "Calibration — microcosm").
  title: {
    default: "Calibration diagnostics — microcosm",
    template: "%s — microcosm",
  },
  description:
    "Interactive diagnostics for the microcosm weighted synthetic population — how closely the calibrated data matches official statistics, release over release.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable}`}>
      <body>
        <div className="site-grain" aria-hidden="true" />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
