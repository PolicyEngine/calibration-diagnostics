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
import { usePathname, useRouter } from "next/navigation";

export type DashboardMode = "us-data" | "microplex" | "populace" | "comparison";

interface DashboardModeValue {
  mode: DashboardMode;
  setMode: (mode: DashboardMode) => void;
}

const DEFAULT_MODE: DashboardMode = "microplex";

const MODE_HOME: Record<DashboardMode, string> = {
  "us-data": "/summary",
  microplex: "/microplex",
  populace: "/populace",
  comparison: "/comparison",
};

const DashboardModeContext = createContext<DashboardModeValue>({
  mode: DEFAULT_MODE,
  setMode: () => {},
});

function modeFromPath(pathname: string): DashboardMode | null {
  if (pathname.startsWith("/comparison")) return "comparison";
  if (pathname.startsWith("/microplex")) return "microplex";
  if (pathname.startsWith("/populace")) return "populace";
  if (
    pathname.startsWith("/summary") ||
    pathname.startsWith("/analysis") ||
    pathname.startsWith("/targets") ||
    pathname.startsWith("/inventory") ||
    pathname.startsWith("/nodes") ||
    pathname.startsWith("/weights")
  ) {
    return "us-data";
  }
  return null;
}

export function DashboardModeProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [mode, setModeState] = useState<DashboardMode>(() => {
    const pathMode = modeFromPath(pathname);
    if (pathMode) return pathMode;
    if (typeof window === "undefined") return DEFAULT_MODE;
    const stored = window.localStorage.getItem("dashboard-mode");
    return stored === "us-data" ||
      stored === "microplex" ||
      stored === "populace" ||
      stored === "comparison"
      ? stored
      : DEFAULT_MODE;
  });

  useEffect(() => {
    const pathMode = modeFromPath(pathname);
    if (pathMode) {
      setModeState(pathMode);
      window.localStorage.setItem("dashboard-mode", pathMode);
    }
  }, [pathname]);

  const setMode = useCallback(
    (nextMode: DashboardMode) => {
      setModeState(nextMode);
      window.localStorage.setItem("dashboard-mode", nextMode);
      router.push(MODE_HOME[nextMode]);
    },
    [router],
  );

  const value = useMemo(() => ({ mode, setMode }), [mode, setMode]);

  return (
    <DashboardModeContext.Provider value={value}>
      {children}
    </DashboardModeContext.Provider>
  );
}

export function useDashboardMode() {
  return useContext(DashboardModeContext);
}
