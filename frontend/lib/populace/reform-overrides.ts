// Committed reform_validation.json backfills, keyed by release id.
//
// A release can reach the dashboard without a reform_validation.json: builds
// published before out-of-sample simulation was restored (PolicyEngine/populace#175)
// shipped one with null out-of-sample rows, and builds promoted to `latest` that
// skipped the reform-validation step entirely shipped none at all. Both are
// backfilled here — the producer run offline on the released populace_us_2024.h5
// at the build's exact package versions — so the dashboard shows the real numbers
// without a Hugging Face round-trip or republish. `fetchReformValidation` prefers
// / merges a committed override over the native artifact. Provenance for each file
// is in its own _backfill_note.
//
// THIS FILE IS GENERATED. Do not edit by hand — drop a JSON in reform-overrides/
// and run `node scripts/gen-reform-overrides.mjs`. The scheduled backfill workflow
// does this automatically for each new release.

import rv_populace_us_2024_buildi_sparse_rmloss100_6e8e929_20260709T034135Z from "./reform-overrides/populace-us-2024-buildi-sparse-rmloss100-6e8e929-20260709T034135Z.json";
import rv_populace_us_2024_buildj_sparse_rmloss100_75d5add_20260710T094201Z from "./reform-overrides/populace-us-2024-buildj-sparse-rmloss100-75d5add-20260710T094201Z.json";
import rv_populace_us_2024_f0af251_703bd81a565c_20260620T201958Z from "./reform-overrides/populace-us-2024-f0af251-703bd81a565c-20260620T201958Z.json";
import rv_populace_us_2024_sparse_l0_refit_57k_71a0887_national_only_20260701 from "./reform-overrides/populace-us-2024-sparse-l0-refit-57k-71a0887-national-only-20260701.json";

export const REFORM_OVERRIDES: Record<string, unknown> = {
  "populace-us-2024-buildi-sparse-rmloss100-6e8e929-20260709T034135Z": rv_populace_us_2024_buildi_sparse_rmloss100_6e8e929_20260709T034135Z,
  "populace-us-2024-buildj-sparse-rmloss100-75d5add-20260710T094201Z": rv_populace_us_2024_buildj_sparse_rmloss100_75d5add_20260710T094201Z,
  "populace-us-2024-f0af251-703bd81a565c-20260620T201958Z": rv_populace_us_2024_f0af251_703bd81a565c_20260620T201958Z,
  "populace-us-2024-sparse-l0-refit-57k-71a0887-national-only-20260701": rv_populace_us_2024_sparse_l0_refit_57k_71a0887_national_only_20260701,
};
