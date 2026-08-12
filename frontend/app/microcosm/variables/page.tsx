import { AppShell } from "@/components/layout/app-shell";
import { MicrocosmVariableLookupView } from "@/components/microcosm/microcosm-variable-lookup-view";

export default function MicrocosmVariablesPage() {
  return (
    <AppShell>
      <MicrocosmVariableLookupView />
    </AppShell>
  );
}
