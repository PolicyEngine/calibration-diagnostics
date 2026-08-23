import type { Metadata } from "next";
import { Providers } from "./providers";
import "./globals.css";

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
    <html lang="en">
      <body>
        <div className="site-grain" aria-hidden="true" />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
