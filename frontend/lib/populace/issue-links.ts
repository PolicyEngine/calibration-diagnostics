// Reviewed-exclusion and gate reasons carry their tracking issue inline as free
// text — "Reviewed fiscal-refresh exclusion: … Issue #40 …", "populace#359",
// or a bare "#359". The #286 "cannot rot" contract requires every exclusion to
// name a live issue, so the coverage board and certification panel surface that
// link. This module turns those inline references into resolved GitHub URLs
// without a network call.

export interface IssueRef {
  // The text exactly as it appeared, e.g. "populace#359" or "Issue #40".
  label: string;
  owner: string;
  repo: string;
  number: number;
  url: string;
}

// Bare "#NNN" / "Issue #NNN" resolve here. The populace release artifacts are
// produced by PolicyEngine/populace, so its issue tracker is the default home
// for an unqualified reference.
export const DEFAULT_ISSUE_OWNER = "PolicyEngine";
export const DEFAULT_ISSUE_REPO = "populace";

// Short repo names that appear as "<name>#NNN" in producer text, mapped to the
// PolicyEngine repo they name. Anything not listed falls back to the default
// repo but keeps its literal label, so an unknown shorthand still links
// somewhere sensible rather than silently dropping.
const REPO_SHORTNAMES: Record<string, { owner: string; repo: string }> = {
  populace: { owner: "PolicyEngine", repo: "populace" },
  "populace-us-data": { owner: "PolicyEngine", repo: "populace-us-data" },
  "policyengine-us-data": { owner: "PolicyEngine", repo: "policyengine-us-data" },
  "calibration-diagnostics": { owner: "PolicyEngine", repo: "calibration-diagnostics" },
  "policyengine-us": { owner: "PolicyEngine", repo: "policyengine-us" },
  "policyengine-uk": { owner: "PolicyEngine", repo: "policyengine-uk" },
  "policyengine.py": { owner: "PolicyEngine", repo: "policyengine.py" },
};

function issueUrl(owner: string, repo: string, number: number): string {
  return `https://github.com/${owner}/${repo}/issues/${number}`;
}

function resolveRef(
  qualifier: string | undefined,
  numberText: string,
  label: string,
): IssueRef | null {
  const number = Number(numberText);
  if (!Number.isInteger(number) || number <= 0) return null;
  if (qualifier && qualifier.includes("/")) {
    const [owner, repo] = qualifier.split("/");
    if (owner && repo) {
      return { label, owner, repo, number, url: issueUrl(owner, repo, number) };
    }
  }
  if (qualifier) {
    const known = REPO_SHORTNAMES[qualifier.toLowerCase()];
    const owner = known?.owner ?? DEFAULT_ISSUE_OWNER;
    const repo = known?.repo ?? DEFAULT_ISSUE_REPO;
    return { label, owner, repo, number, url: issueUrl(owner, repo, number) };
  }
  return {
    label,
    owner: DEFAULT_ISSUE_OWNER,
    repo: DEFAULT_ISSUE_REPO,
    number,
    url: issueUrl(DEFAULT_ISSUE_OWNER, DEFAULT_ISSUE_REPO, number),
  };
}

// Ordered alternatives: owner/repo#N, shorthand#N, "Issue #N" phrase, bare #N.
// A single global regex so one linear pass tokenizes the text; group indices
// tell which alternative fired.
function tokenRegex(): RegExp {
  return new RegExp(
    [
      "([A-Za-z0-9_.-]+\\/[A-Za-z0-9_.-]+)#(\\d+)", // 1,2 owner/repo#N
      "([A-Za-z0-9_.][A-Za-z0-9_.-]*)#(\\d+)", //     3,4 shorthand#N
      "[Ii]ssues?\\s+#(\\d+)", //                     5   "Issue #N" / "Issues #N"
      "#(\\d+)", //                                    6   bare #N
    ].join("|"),
    "g",
  );
}

// Split free text into a stream of plain strings and resolved issue references,
// in order, so a renderer can print the reason with its issue link inline. Plain
// runs between references are returned verbatim (never dropped).
export function tokenizeIssueRefs(text: string): Array<string | IssueRef> {
  if (!text) return [];
  const tokens: Array<string | IssueRef> = [];
  const re = tokenRegex();
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const [full, ownerRepo, ownerRepoNum, shorthand, shorthandNum, phraseNum, bareNum] =
      match;
    let ref: IssueRef | null = null;
    if (ownerRepo && ownerRepoNum) ref = resolveRef(ownerRepo, ownerRepoNum, full);
    else if (shorthand && shorthandNum) ref = resolveRef(shorthand, shorthandNum, full);
    else if (phraseNum) ref = resolveRef(undefined, phraseNum, full);
    else if (bareNum) ref = resolveRef(undefined, bareNum, full);
    // A zero-width or invalid match can't advance the loop — guard against it.
    if (re.lastIndex === match.index) re.lastIndex += 1;
    if (!ref) continue;
    if (match.index > lastIndex) tokens.push(text.slice(lastIndex, match.index));
    tokens.push(ref);
    lastIndex = match.index + full.length;
  }
  if (lastIndex < text.length) tokens.push(text.slice(lastIndex));
  return tokens;
}

// The distinct issue references in a block of text, de-duplicated by URL and in
// first-seen order — for a compact "linked issues" chip row.
export function extractIssueRefs(text: string): IssueRef[] {
  const seen = new Set<string>();
  const refs: IssueRef[] = [];
  for (const token of tokenizeIssueRefs(text)) {
    if (typeof token === "string") continue;
    if (seen.has(token.url)) continue;
    seen.add(token.url);
    refs.push(token);
  }
  return refs;
}
