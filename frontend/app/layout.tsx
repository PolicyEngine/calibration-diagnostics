import type { Metadata } from "next";
import { IBM_Plex_Mono, STIX_Two_Text, Urbanist } from "next/font/google";
import { Providers } from "./providers";
import "./globals.css";

// The Microcosm faces (constellation-design/tokens/microcosm.css) — the same
// three families microcosm.institute vendors — self-hosted here via next/font
// so the dashboard renders identically with no external request. Exposed as
// CSS variables that globals.css points --font-sans / --font-mono /
// --font-wordmark at.
const stixTwoText = STIX_Two_Text({
  subsets: ["latin"],
  style: ["normal", "italic"],
  variable: "--font-stix",
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
      className={`${stixTwoText.variable} ${ibmPlexMono.variable} ${urbanist.variable}`}
    >
      <body>
        <div className="site-grain" aria-hidden="true" />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
