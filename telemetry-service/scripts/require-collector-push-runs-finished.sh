#!/usr/bin/env bash
# Fail while any PolicyEngine/microcosm-collector Push run is unfinished.
#
# A Push run on a release commit reads COLLECTOR_DEPLOY_ENABLED only when it
# reaches its deployment jobs, after verify and tag, and a deployment that has
# started keeps going if the variable is unset later. So a redeploy from this
# repo waits until no Push run is queued, waiting or in progress. The
# microcosm-collector repo is public, so this workflow's own token can list its
# runs; it cannot read that repo's variables.
set -Eeuo pipefail

readonly COLLECTOR_PUSH_RUNS_ENDPOINT="repos/PolicyEngine/microcosm-collector/actions/workflows/push.yaml/runs?per_page=100"

collector_push_runs=$(gh api "$COLLECTOR_PUSH_RUNS_ENDPOINT")
unfinished_run_urls=$(jq -r '[.workflow_runs[] | select(.status != "completed") | .html_url] | join(" ")' <<<"$collector_push_runs")

if [[ -n "$unfinished_run_urls" ]]; then
  echo "::error::Nothing was deployed. These PolicyEngine/microcosm-collector Push runs are not finished, and one may still deploy: ${unfinished_run_urls}. Check that COLLECTOR_DEPLOY_ENABLED is unset there, wait for the runs to finish, then dispatch again."
  exit 1
fi
echo "No PolicyEngine/microcosm-collector Push run is queued or in progress."
