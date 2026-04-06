"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

export type GeoLevel = "national" | "state" | "district";

export interface GeoFilter {
  level: GeoLevel;
  stateFips?: number;
  cdGeoid?: number;
  label: string;
}

interface GeoContextValue {
  geo: GeoFilter;
  setGeo: (geo: GeoFilter) => void;
}

const GeoContext = createContext<GeoContextValue>({
  geo: { level: "national", label: "National" },
  setGeo: () => {},
});

export function GeoProvider({ children }: { children: ReactNode }) {
  const [geo, setGeo] = useState<GeoFilter>({
    level: "national",
    label: "National",
  });
  return (
    <GeoContext.Provider value={{ geo, setGeo }}>
      {children}
    </GeoContext.Provider>
  );
}

export function useGeo() {
  return useContext(GeoContext);
}

export function useGeoParams() {
  const { geo } = useGeo();
  return {
    stateFips: geo.stateFips,
    cdGeoid: geo.cdGeoid,
    geoLevel: geo.level,
  };
}
