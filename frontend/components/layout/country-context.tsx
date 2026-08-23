"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

export type Country = "us" | "uk" | "be";

const COUNTRIES = new Set<Country>(["us", "uk", "be"]);

export function isCountry(value: string | null): value is Country {
  return value != null && COUNTRIES.has(value as Country);
}

const STORAGE_KEY = "microcosm-country";

export function countrySwitchUrl(currentUrl: string, next: Country): string {
  const url = new URL(currentUrl);
  if (url.pathname.endsWith("/microcosm/datasets")) {
    url.search = "";
  }
  url.searchParams.set("country", next);
  return url.toString();
}

function persistCountry(country: Country) {
  try {
    window.localStorage.setItem(STORAGE_KEY, country);
  } catch {
    // Ignore storage failures (private mode, etc.).
  }
}

interface CountryContextValue {
  country: Country;
  setCountry: (country: Country) => void;
}

const CountryContext = createContext<CountryContextValue>({
  country: "us",
  setCountry: () => {},
});

export function CountryProvider({ children }: { children: ReactNode }) {
  const [country, setCountryState] = useState<Country>("us");

  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("country");
    if (isCountry(requested)) {
      setCountryState(requested);
      persistCountry(requested);
      return;
    }
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (isCountry(stored)) setCountryState(stored);
  }, []);

  const setCountry = (next: Country) => {
    if (next === country) return;
    setCountryState(next);
    persistCountry(next);
    window.history.replaceState(
      window.history.state,
      "",
      countrySwitchUrl(window.location.href, next),
    );
  };

  return (
    <CountryContext.Provider value={{ country, setCountry }}>
      {children}
    </CountryContext.Provider>
  );
}

export function useCountry(): CountryContextValue {
  return useContext(CountryContext);
}
