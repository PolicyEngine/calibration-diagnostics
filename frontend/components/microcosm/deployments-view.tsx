"use client";

import Link from "next/link";

import { useCountry } from "@/components/layout/country-context";
import { EmptyState } from "@/components/shared/empty-state";
import { LoadingBlock } from "@/components/shared/LoadingBlock";
import { PageHeader } from "@/components/shared/page-header";
import { SectionCard } from "@/components/shared/section-card";
import { StatusPill, type StatusTone } from "@/components/shared/status-pill";
import { useMicrocosmDeployments } from "@/lib/api/hooks/use-microcosm";
import { countryRegistration, hasCapability } from "@/lib/microcosm/countries";
import {
  isMicrocosmBuild,
  PY_BUNDLE_MANIFEST_PATH,
  PY_REPOSITORY,
  type DeploymentRow,
  type DeploymentStatus,
} from "@/lib/microcosm/deployments";

// ---------------------------------------------------------------------------
// Which .py, country model and data build each PolicyEngine surface declares.
// Declared = the dependency lock on the repository's default branch; it can
// differ from what is deployed until each service reports its own versions.
// ---------------------------------------------------------------------------

const STATUS: Record<DeploymentStatus, { label: string; tone: StatusTone }> = {
  current: { label: "Latest data", tone: "success" },
  behind: { label: "Older data", tone: "warning" },
  model_mismatch: { label: "Model mismatch", tone: "danger" },
  no_bundle: { label: "No certified data", tone: "danger" },
  no_py: { label: "No .py", tone: "warning" },
  not_in_bundle: { label: "Country not in bundle", tone: "neutral" },
  unavailable: { label: "Lock unavailable", tone: "neutral" },
};

function bundleUrl(pyVersion: string): string {
  return `https://github.com/${PY_REPOSITORY}/blob/${pyVersion}/${PY_BUNDLE_MANIFEST_PATH}`;
}

function Version({ value }: { value: string | null }) {
  return value ? (
    <span className="font-mono text-xs">{value}</span>
  ) : (
    <span className="text-xs text-muted-foreground">—</span>
  );
}

function BuildLink({ buildId, country }: { buildId: string | null; country: string }) {
  if (!buildId) return <span className="text-xs text-muted-foreground">—</span>;
  if (!isMicrocosmBuild(buildId)) {
    return (
      <span className="break-all font-mono text-xs" title="Not a Microcosm release">
        {buildId}
      </span>
    );
  }
  return (
    <Link
      href={`/microcosm?country=${country}&release=${encodeURIComponent(buildId)}`}
      className="break-all font-mono text-xs text-foreground hover:text-primary hover:underline"
    >
      {buildId}
    </Link>
  );
}

function SurfaceCell({ row }: { row: DeploymentRow }) {
  const { surface } = row;
  return (
    <>
      <div className="font-medium text-foreground">{surface.label}</div>
      <div className="mt-0.5 text-xs text-muted-foreground">{surface.serves}</div>
      <div className="mt-1 text-xs">
        <a
          href={`https://github.com/${surface.repository}`}
          target="_blank"
          rel="noreferrer"
          className="text-muted-foreground underline decoration-dotted underline-offset-2 hover:text-primary"
        >
          {surface.repository.replace("PolicyEngine/", "")}
        </a>
        {row.lock_url && (
          <>
            {" · "}
            <a
              href={row.lock_url}
              target="_blank"
              rel="noreferrer"
              className="text-muted-foreground underline decoration-dotted underline-offset-2 hover:text-primary"
            >
              lock
            </a>
          </>
        )}
      </div>
    </>
  );
}

export function DeploymentsView() {
  const { country } = useCountry();
  const query = useMicrocosmDeployments();
  const registration = countryRegistration(country);

  if (!hasCapability(country, "deployments")) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader eyebrow="Microcosm · releases" title="Deployments" />
        <EmptyState
          title="Deployments unavailable"
          description={`No .py bundle tracks a ${registration.label} data release.`}
        />
      </div>
    );
  }

  const data = query.data;
  const modelLabel = data?.model_package ?? "Country model";

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Microcosm · releases"
        title="Deployments"
        description={
          <span className="block text-pretty">
            {`Each PolicyEngine surface pins a .py version, and that .py certifies one ${registration.dataset_label} build. `}
            Versions come from each repository&apos;s lock file on its default branch, so a
            running service can be older.
          </span>
        }
      />

      {query.isLoading && <LoadingBlock label="Reading lock files and .py bundle manifests…" />}
      {query.error && (
        <EmptyState
          title="Could not read deployments"
          description={query.error instanceof Error ? query.error.message : String(query.error)}
        />
      )}

      {data && (
        <>
          <SectionCard
            title="Latest certified bundle"
            description="The newest .py release on PyPI and the data build its bundle manifest certifies."
          >
            {data.latest ? (
              <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-3">
                <div>
                  <dt className="text-xs text-muted-foreground">.py</dt>
                  <dd className="mt-1">
                    <a
                      href={bundleUrl(data.latest.py_version)}
                      target="_blank"
                      rel="noreferrer"
                      className="font-mono text-xs underline decoration-dotted underline-offset-2 hover:text-primary"
                    >
                      {data.latest.py_version}
                    </a>
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">{modelLabel} (certified)</dt>
                  <dd className="mt-1">
                    <Version value={data.latest.certified_model_version} />
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Data build</dt>
                  <dd className="mt-1">
                    <BuildLink buildId={data.latest.data_build_id} country={country} />
                  </dd>
                </div>
              </dl>
            ) : (
              <p className="text-sm text-muted-foreground">
                Unknown: {data.latest_error ?? "the latest .py bundle could not be read."}
              </p>
            )}
          </SectionCard>

          <SectionCard
            title="Surfaces"
            description="Declared on each repository's default branch. The data build is the one the surface's .py certifies for this country."
            padded={false}
            footer={`Checked ${new Date(data.checked_at).toLocaleString("en-US")}. Cached for 15 minutes.`}
          >
            <div className="overflow-x-auto">
              <table className="w-full min-w-[960px] text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/10 text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th scope="col" className="min-w-[220px] px-4 py-2.5">Surface</th>
                    <th scope="col" className="min-w-[240px] px-4 py-2.5">Status</th>
                    <th scope="col" className="px-4 py-2.5">.py</th>
                    <th scope="col" className="px-4 py-2.5">{modelLabel}</th>
                    <th scope="col" className="px-4 py-2.5">Core</th>
                    <th scope="col" className="min-w-[260px] px-4 py-2.5">Data build</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((row) => (
                    <tr
                      key={row.surface.id}
                      className="border-b border-border last:border-0 hover:bg-muted/20"
                    >
                      <td className="px-4 py-3 align-top">
                        <SurfaceCell row={row} />
                      </td>
                      <td className="max-w-[280px] px-4 py-3 align-top">
                        <StatusPill tone={STATUS[row.status].tone}>
                          {STATUS[row.status].label}
                        </StatusPill>
                        <div className="mt-1.5 text-xs leading-snug text-muted-foreground">
                          {row.detail}
                        </div>
                      </td>
                      <td className="px-4 py-3 align-top">
                        {row.py_version ? (
                          <a
                            href={bundleUrl(row.py_version)}
                            target="_blank"
                            rel="noreferrer"
                            className="font-mono text-xs underline decoration-dotted underline-offset-2 hover:text-primary"
                          >
                            {row.py_version}
                          </a>
                        ) : (
                          <Version value={null} />
                        )}
                      </td>
                      <td className="px-4 py-3 align-top">
                        <Version value={row.model_version} />
                      </td>
                      <td className="px-4 py-3 align-top">
                        <Version value={row.core_version} />
                      </td>
                      <td className="px-4 py-3 align-top">
                        <BuildLink buildId={row.data_build_id} country={country} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </SectionCard>
        </>
      )}
    </div>
  );
}
