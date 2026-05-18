"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { setCurrentRun } from "./api/client";

export interface RunSelection {
  dataset: string | null;
  run: string | null;
}

interface RunContextValue extends RunSelection {
  setSelection: (sel: RunSelection) => void;
}

const RunContext = createContext<RunContextValue>({
  dataset: null,
  run: null,
  setSelection: () => {},
});

export function RunProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();

  // Initial selection comes from URL search params; falls back to null.
  const [selection, setSelectionState] = useState<RunSelection>({
    dataset: searchParams.get("dataset"),
    run: searchParams.get("run"),
  });

  // Keep apiGet's global in sync with the current selection so every request
  // automatically carries ?dataset & ?run without touching individual hooks.
  useEffect(() => {
    setCurrentRun({
      dataset: selection.dataset ?? undefined,
      run: selection.run ?? undefined,
    });
    // Invalidate so already-cached views refetch against the new run.
    queryClient.invalidateQueries();
  }, [selection.dataset, selection.run, queryClient]);

  const setSelection = useCallback(
    (sel: RunSelection) => {
      setSelectionState(sel);
      const params = new URLSearchParams(searchParams.toString());
      if (sel.dataset) params.set("dataset", sel.dataset);
      else params.delete("dataset");
      if (sel.run) params.set("run", sel.run);
      else params.delete("run");
      router.replace(`${pathname}?${params.toString()}`);
    },
    [pathname, router, searchParams],
  );

  const value = useMemo(
    () => ({ ...selection, setSelection }),
    [selection, setSelection],
  );

  return <RunContext.Provider value={value}>{children}</RunContext.Provider>;
}

export function useRunContext() {
  return useContext(RunContext);
}
