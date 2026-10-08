#!/usr/bin/env bash

set -Eeuo pipefail

require_configuration() {
  local missing=()
  local name
  for name in \
    MODAL_TOKEN_ID MODAL_TOKEN_SECRET MICROCOSM_MODAL_KEY MICROCOSM_MODAL_SECRET \
    MICROCOSM_TELEMETRY_COLLECTOR_URL VERCEL_TOKEN VERCEL_AUTOMATION_BYPASS_SECRET
  do
    if [[ -z "${!name-}" ]]; then missing+=("$name"); fi
  done
  if (( ${#missing[@]} )); then
    echo "Missing required production configuration: ${missing[*]}" >&2
    return 1
  fi
}

install_clients() {
  uv venv --python 3.12 .deploy-venv
  uv pip install --python .deploy-venv/bin/python modal==1.5.5
  bunx --bun "vercel@${VERCEL_CLI_VERSION}" --version
}

define_backend() {
  echo "source_commit=$SOURCE_COMMIT" >> "$GITHUB_OUTPUT"
  echo "modal_app=calibration-diagnostics-${SOURCE_COMMIT:0:12}" >> "$GITHUB_OUTPUT"
}

resolve_backend() {
  local backend_url
  backend_url="$(.deploy-venv/bin/python -c \
    'import modal, os; url = modal.Function.from_name(os.environ["CALIBRATION_MODAL_APP_NAME"], "web_app", environment_name=os.environ["MODAL_ENVIRONMENT"]).get_web_url(); assert url; print(url)')"
  if [[ ! "$backend_url" =~ ^https://.+\.modal\.run/?$ ]]; then
    echo "Modal returned an invalid web URL." >&2
    return 1
  fi
  echo "::add-mask::$backend_url"
  echo "url=${backend_url%/}" >> "$GITHUB_OUTPUT"
}

deploy_frontend() {
  local deployment_url
  deployment_url="$(bunx --bun "vercel@${VERCEL_CLI_VERSION}" deploy . \
    --yes --prod --skip-domain --no-color \
    --scope policy-engine --project "$VERCEL_PROJECT_ID" --token "$VERCEL_TOKEN" \
    --env "MICROCOSM_CALCULATION_URL=$MICROCOSM_CALCULATION_URL" \
    --env "MICROCOSM_MODAL_KEY=$MICROCOSM_MODAL_KEY" \
    --env "MICROCOSM_MODAL_SECRET=$MICROCOSM_MODAL_SECRET" \
    --env "MICROCOSM_TELEMETRY_COLLECTOR_URL=$MICROCOSM_TELEMETRY_COLLECTOR_URL" \
    --env "MICROCOSM_BACKEND_SOURCE_COMMIT=$MICROCOSM_BACKEND_SOURCE_COMMIT")"
  if [[ ! "$deployment_url" =~ ^https://.+\.vercel\.app/?$ ]]; then
    echo "Vercel returned an invalid deployment URL." >&2
    return 1
  fi
  echo "url=${deployment_url%/}" >> "$GITHUB_OUTPUT"
}

case "${1:-}" in
  require-configuration) require_configuration ;;
  install-clients) install_clients ;;
  define-backend) define_backend ;;
  resolve-backend) resolve_backend ;;
  deploy-frontend) deploy_frontend ;;
  *) echo "Unknown dashboard deployment command." >&2; exit 2 ;;
esac
