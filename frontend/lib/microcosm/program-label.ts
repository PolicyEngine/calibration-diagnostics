// These are exact, domain-approved tokens—not guesses based on word length.
const PROGRAM_ACRONYM_LABELS: Readonly<Record<string, string>> = {
  aca: "ACA",
  actc: "ACTC",
  agi: "AGI",
  amt: "AMT",
  ctc: "CTC",
  eitc: "EITC",
  fica: "FICA",
  fsa: "FSA",
  hsa: "HSA",
  ira: "IRA",
  magi: "MAGI",
  oasdi: "OASDI",
  ptc: "PTC",
  qbi: "QBI",
  salt: "SALT",
  se: "SE",
  snap: "SNAP",
  ssi: "SSI",
  tanf: "TANF",
  ui: "UI",
};

function canonicalProgramKey(identifier: string): string {
  return identifier
    .trim()
    .toLowerCase()
    .replace(/[_\s-]+/g, "_");
}

/**
 * Resolve a program's presentation label without changing its canonical ID.
 * An upstream label wins when release artifacts begin supplying one; otherwise
 * exact domain overrides precede a conservative sentence-case fallback.
 */
export function programLabel(
  identifier: string | null | undefined,
  explicitLabel?: string | null,
): string {
  const suppliedLabel = explicitLabel?.trim();
  if (suppliedLabel) return suppliedLabel;

  if (!identifier?.trim()) return "";
  const key = canonicalProgramKey(identifier);
  return key
    .split("_")
    .map((token, index) => {
      const acronym = PROGRAM_ACRONYM_LABELS[token];
      if (acronym) return acronym;
      return index === 0 ? token[0].toUpperCase() + token.slice(1) : token;
    })
    .join(" ");
}
