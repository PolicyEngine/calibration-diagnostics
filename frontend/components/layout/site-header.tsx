import { withBasePath } from "@/lib/base-path";

// populace.dev-style top bar for the mounted dashboard.
//
// Replaces the ui-kit <Header>, which read as a hard context switch out of
// populace.dev (issue #99). Carries a breadcrumb back up to the calibration
// strategy essay and the site home, plus the site's editorial nav voice.
//
// Links that point back into populace.dev (home, /calibration, /papers, hash
// anchors) are ROOT-relative and must NOT carry the dashboard basePath — the
// dashboard is mounted under the same domain, so a raw <a href="/calibration">
// resolves to populace.dev/calibration. next/link / withBasePath are reserved
// for in-app routes (the dashboard's own pages).
const REPO = "https://github.com/PolicyEngine/calibration-diagnostics";

const EDITORIAL_LINKS: { href: string; label: string }[] = [
  { href: "/#idea", label: "the idea" },
  { href: "/#stack", label: "the stack" },
  { href: "/#result", label: "evidence" },
  { href: "/papers", label: "papers" },
];

export function SiteHeader() {
  return (
    <header className="site-nav">
      <div className="site-crumb">
        {/* brand → populace.dev home */}
        <a className="site-brand" href="/">
          <span className="site-brand-dot" aria-hidden="true" />
          populace
        </a>
        <span className="site-crumb-sep" aria-hidden="true">
          /
        </span>
        {/* → the calibration strategy essay the dashboard sits beneath */}
        <a href="/calibration">calibration</a>
        <span className="site-crumb-sep" aria-hidden="true">
          /
        </span>
        {/* current surface → dashboard landing */}
        <a className="site-crumb-current" href={withBasePath("/populace")}>
          dashboard
        </a>
      </div>

      <nav className="site-nav-links" aria-label="populace">
        {EDITORIAL_LINKS.map((link) => (
          <a key={link.href} className="site-nav-editorial" href={link.href}>
            {link.label}
          </a>
        ))}
        <a
          className="site-nav-gh"
          href={REPO}
          aria-label="GitHub repository"
          target="_blank"
          rel="noreferrer"
        >
          <svg
            viewBox="0 0 24 24"
            width="18"
            height="18"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M9 19c-4.3 1.4 -4.3 -2.5 -6 -3m12 5v-3.5c0 -1 .1 -1.4 -.5 -2c2.8 -.3 5.5 -1.4 5.5 -6a4.6 4.6 0 0 0 -1.3 -3.2a4.2 4.2 0 0 0 -.1 -3.2s-1.1 -.3 -3.5 1.3a12.3 12.3 0 0 0 -6.2 0c-2.4 -1.6 -3.5 -1.3 -3.5 -1.3a4.2 4.2 0 0 0 -.1 3.2a4.6 4.6 0 0 0 -1.3 3.2c0 4.6 2.7 5.7 5.5 6c-.6 .6 -.6 1.2 -.5 2v3.5" />
          </svg>
        </a>
      </nav>
    </header>
  );
}
