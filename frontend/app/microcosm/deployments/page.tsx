import { AppShell } from "@/components/layout/app-shell";
import { DeploymentsView } from "@/components/microcosm/deployments-view";

export default function MicrocosmDeploymentsPage() {
  return (
    <AppShell>
      <DeploymentsView />
    </AppShell>
  );
}
