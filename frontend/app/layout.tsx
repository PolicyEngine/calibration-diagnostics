import type { Metadata } from "next";
import { IBM_Plex_Mono, Inter, Urbanist } from "next/font/google";
import { Providers } from "./providers";
import "./globals.css";

// Keep dashboard content in the sans-serif face used before the Microcosm
// rebrand while retaining the identity's mono labels and wordmark. All three
// families are self-hosted via next/font and exposed as CSS variables that
// globals.css points --font-sans / --font-mono / --font-wordmark at.
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const ibmPlexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-plex",
  display: "swap",
});

// Wordmark only: the monoline whose o is the operator.
const urbanist = Urbanist({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-urbanist",
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
    "Interactive diagnostics for microcosm's calibrated synthetic microdata — how closely the weighted data matches official statistics, release over release.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${ibmPlexMono.variable} ${urbanist.variable}`}
    >
      <body>
        <div className="site-grain" aria-hidden="true" />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
