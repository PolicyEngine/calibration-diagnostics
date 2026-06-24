// Committed corrections for reform_validation.json.
//
// Releases published before the build pipeline restored out-of-sample reform
// simulation (PolicyEngine/populace#175) shipped a reform_validation.json whose
// out-of-sample (OBBBA / tax-expenditure) rows all had a null budget effect —
// the build was run with --skip-out-of-sample-reforms. Those numbers were
// recomputed offline by running the producer's own reform-validation simulation
// on the released populace_us_2024.h5 (policyengine-us 1.729.0 / pe-core
// 3.26.11, matching the build) and committed here, so the dashboard shows the
// real numbers without a Hugging Face round-trip or republish.
//
// New releases simulate out-of-sample by default and won't appear here; this
// map is a finite backfill of already-published releases, keyed by release id.

import f0af251 from "./reform-overrides/populace-us-2024-f0af251-703bd81a565c-20260620T201958Z.json";

export const REFORM_OVERRIDES: Record<string, unknown> = {
  "populace-us-2024-f0af251-703bd81a565c-20260620T201958Z": f0af251,
};
