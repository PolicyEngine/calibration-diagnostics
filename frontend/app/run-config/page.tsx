"use client";

import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Stack,
  Text,
  Title,
  formatNumber,
} from "@policyengine/ui-kit";

import { AppShell } from "@/components/layout/app-shell";
import { LoadingBlock } from "@/components/shared/LoadingBlock";
import { useRunConfig } from "@/lib/api/hooks/use-run-config";

const HIGHLIGHT_KEYS = [
  "n_targets",
  "n_records",
  "n_clones",
  "epochs",
  "learning_rate",
  "beta",
  "lambda_l0",
  "lambda_l2",
  "seed",
  "device",
  "weight_format",
  "weight_sum",
  "weight_nonzero",
  "elapsed_seconds",
  "mean_error_pct",
  "package_version",
  "git_commit",
  "git_branch",
  "git_dirty",
  "skip_source_impute",
] as const;

function fmtValue(v: unknown): string {
  if (v === null) return "—";
  if (typeof v === "number")
    return Number.isInteger(v) ? formatNumber(v) : v.toString();
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "string") return v;
  return JSON.stringify(v);
}

export default function RunConfigPage() {
  const { data, isLoading, error } = useRunConfig();

  let body;
  if (isLoading) {
    body = <LoadingBlock label="Loading run config…" />;
  } else if (error) {
    body = (
      <Card>
        <CardContent>
          <Text size="sm" c="dimmed">
            No <code>unified_run_config.json</code> was published for the
            loaded run. This is expected for sandbox/pkl-mode runs — only
            staging-layout runs from <code>policyengine-us-data</code>{" "}
            include the config artifact.
          </Text>
        </CardContent>
      </Card>
    );
  } else if (data) {
    const cfg = data.config;
    const known = HIGHLIGHT_KEYS.filter((k) => k in cfg);
    const rest = Object.keys(cfg)
      .filter((k) => !HIGHLIGHT_KEYS.includes(k as typeof HIGHLIGHT_KEYS[number]))
      .sort();

    body = (
      <Stack gap="md">
        <Card>
          <CardHeader>
            <CardTitle>Fit parameters</CardTitle>
          </CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <tbody>
                {known.map((k) => (
                  <tr key={k} className="border-b border-border/40">
                    <td className="py-1.5 pr-4 font-mono text-xs text-muted-foreground">
                      {k}
                    </td>
                    <td className="py-1.5 tabular-nums">
                      {fmtValue(cfg[k])}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>

        {rest.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Other fields</CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="text-xs whitespace-pre-wrap break-all overflow-x-auto">
                {JSON.stringify(
                  Object.fromEntries(rest.map((k) => [k, cfg[k]])),
                  null,
                  2,
                )}
              </pre>
            </CardContent>
          </Card>
        )}
      </Stack>
    );
  } else {
    body = null;
  }

  return (
    <AppShell>
      <Stack gap="lg">
        <div className="flex items-baseline gap-3">
          <Title order={2}>Run config</Title>
          {data && (
            <Badge variant={data.fit_scope === "national" ? "secondary" : "success"}>
              {data.fit_scope} scope
            </Badge>
          )}
        </div>
        <Text c="dimmed" size="sm">
          The published <code>unified_run_config.json</code> for the loaded
          run — fit parameters, target/record counts, runtime, and the git
          state of the calibration pipeline. Source: us-data Stage 3
          artifacts catalog.
        </Text>
        {body}
      </Stack>
    </AppShell>
  );
}
