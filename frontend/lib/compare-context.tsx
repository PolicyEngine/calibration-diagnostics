"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

interface CompareCtx {
  enabled: boolean;
  setEnabled: (v: boolean) => void;
  runB: string | null;
  setRunB: (v: string | null) => void;
}

const Ctx = createContext<CompareCtx | null>(null);

export function CompareProvider({ children }: { children: ReactNode }) {
  const [enabled, setEnabled] = useState(false);
  const [runB, setRunB] = useState<string | null>(null);
  return (
    <Ctx.Provider value={{ enabled, setEnabled, runB, setRunB }}>
      {children}
    </Ctx.Provider>
  );
}

export function useCompareMode() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useCompareMode must be used inside CompareProvider");
  return c;
}
