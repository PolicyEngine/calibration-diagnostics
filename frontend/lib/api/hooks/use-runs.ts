import { useQuery } from "@tanstack/react-query";
import { apiGet } from "../client";
import { useRunContext } from "@/lib/run-context";

export interface DatasetDescriptor {
  id: string;
  label: string;
  repo_id: string;
  primary_h5?: string;
}

export interface RunDescriptor {
  dataset_id: string;
  run_id: string;
  label: string;
  last_modified: string | null;
}

export function useDatasets() {
  return useQuery({
    queryKey: ["datasets"],
    queryFn: () => apiGet<DatasetDescriptor[]>("/datasets"),
    staleTime: 30 * 60 * 1000,
  });
}

export function useRuns(dataset: string | null | undefined) {
  return useQuery({
    queryKey: ["runs", dataset],
    queryFn: () => apiGet<RunDescriptor[]>("/runs", { dataset: dataset! }),
    enabled: !!dataset,
    staleTime: 10 * 60 * 1000,
  });
}

export function useRunQueryState() {
  const { dataset, run } = useRunContext();
  const datasetsQ = useDatasets();
  const datasetIsValid =
    !!dataset && !!datasetsQ.data?.some((d) => d.id === dataset);
  const runsQ = useRuns(datasetIsValid ? dataset : null);
  const runIsValid = !!run && !!runsQ.data?.some((r) => r.run_id === run);

  return {
    dataset,
    run,
    datasetsQ,
    runsQ,
    ready: datasetIsValid && runIsValid,
  };
}
