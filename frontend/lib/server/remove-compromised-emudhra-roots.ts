import { X509Certificate } from "node:crypto";
import tls from "node:tls";

// Vercel Functions still run Node.js 24.21.0 and 22.23.2, which trust the
// compromised eMudhra root "emSign ECC Root CA - G3" (and Sectigo's
// "AAA Certificate Services", which cross-signed the affected intermediates).
// Remove both from Node's default CA list before any outbound request.
// Delete this once Vercel Functions run Node.js 24.22.1 / 22.23.4 or later.
const COMPROMISED_ROOT_COMMON_NAMES = [
  "emSign ECC Root CA - G3",
  "AAA Certificate Services",
];

export function removeCompromisedEmudhraRoots(): void {
  if (
    typeof tls.getCACertificates !== "function" ||
    typeof tls.setDefaultCACertificates !== "function"
  ) {
    return;
  }
  const trusted = tls.getCACertificates("default").filter((pem) => {
    const subjectFields = new X509Certificate(pem).subject.split("\n");
    return !COMPROMISED_ROOT_COMMON_NAMES.some((name) =>
      subjectFields.includes("CN=" + name),
    );
  });
  tls.setDefaultCACertificates(trusted);
}
