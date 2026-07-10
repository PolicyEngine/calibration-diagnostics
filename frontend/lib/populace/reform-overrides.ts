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
// A second case: a build promoted to `latest` that skipped the reform-validation
// step entirely and shipped no reform_validation.json at all. That gets a full
// offline reproduction — the producer run end-to-end on the released H5 at the
// build's exact package versions — rather than a patch of a partial artifact.
//
// New releases simulate out-of-sample by default and won't appear here; this
// map is a finite backfill of already-published releases, keyed by release id.

import f0af251 from "./reform-overrides/populace-us-2024-f0af251-703bd81a565c-20260620T201958Z.json";
// State legislative reform rows (PolicyEngine/populace#319 suite) appended
// offline to the published artifact — scored one reform at a time on the
// released H5. See _backfill_note inside the file for version provenance.
import nationalOnly20260701 from "./reform-overrides/populace-us-2024-sparse-l0-refit-57k-71a0887-national-only-20260701.json";
// The buildi-sparse-rmloss100 build was promoted to latest with no
// reform_validation.json (its build run skipped the reform-validation step), so
// this is a FULL offline reproduction — the producer run on the released H5 at
// the exact build versions (pe-us 1.764.6), not a patch of a partial artifact.
// See _backfill_note inside the file for provenance.
import buildiSparseRmloss100 from "./reform-overrides/populace-us-2024-buildi-sparse-rmloss100-6e8e929-20260709T034135Z.json";

export const REFORM_OVERRIDES: Record<string, unknown> = {
  "populace-us-2024-f0af251-703bd81a565c-20260620T201958Z": f0af251,
  "populace-us-2024-sparse-l0-refit-57k-71a0887-national-only-20260701":
    nationalOnly20260701,
  "populace-us-2024-buildi-sparse-rmloss100-6e8e929-20260709T034135Z":
    buildiSparseRmloss100,
};
