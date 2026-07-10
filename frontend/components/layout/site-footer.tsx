import { withBasePath } from "@/lib/base-path";

// Mirrors populace.dev's footer (.foot) so the dashboard closes the same way
// every site page does: brand on the left, PolicyEngine wordmark on the right,
// and the shared one-line provenance note.
export function SiteFooter() {
  return (
    <footer className="site-foot">
      <div className="site-foot-row">
        <a className="site-brand" href="/">
          <span className="site-brand-dot" aria-hidden="true" />
          populace
        </a>
        <a
          className="site-foot-pe"
          href="https://policyengine.org"
          aria-label="PolicyEngine"
          target="_blank"
          rel="noreferrer"
        >
          {/* checked-in local asset (public/policyengine.svg), served under the
              dashboard basePath — no hotlinking raw GitHub URLs. */}
          <img src={withBasePath("/policyengine.svg")} alt="PolicyEngine" />
        </a>
      </div>
      <p className="site-foot-fine">
        A weighted synthetic population for public policy. Open source · MIT · a
        PolicyEngine project.
      </p>
    </footer>
  );
}
