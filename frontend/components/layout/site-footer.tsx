import { Wordmark } from "./wordmark";

// Mirrors microcosm.institute's footer (.foot) so the dashboard closes the same way
// every site page does: the wordmark on the left and the shared one-line
// provenance note, with the PolicyEngine credit as a quiet text link.
export function SiteFooter() {
  return (
    <footer className="site-foot">
      <div className="site-foot-row">
        <a className="site-brand" href="/">
          <Wordmark />
        </a>
      </div>
      <p className="site-foot-fine">
        Calibrated synthetic microdata for public policy. Open source ·{" "}
        <a href="https://policyengine.org" target="_blank" rel="noreferrer">
          a PolicyEngine project
        </a>
        .
      </p>
    </footer>
  );
}
