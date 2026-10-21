"use client";

import {
  Suspense,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";

import {
  DEFAULT_COUNTRY,
  countryParam,
  isCountry,
  isSelectableCountry,
  type MicrocosmCountry,
} from "@policyengine/calibration-tree/countries";

export type Country = MicrocosmCountry;

export interface CountryReleaseSelection {
  country: Country;
  value: string;
}

export { isCountry };

const STORAGE_KEY = "microcosm-country";

export function countrySwitchUrl(currentUrl: string, next: Country): string {
  const url = new URL(currentUrl);
  if (url.pathname.endsWith("/microcosm/datasets")) {
    url.search = "";
  } else {
    // Release identifiers are repository-specific. A release selected for one
    // country must never be requested from another country's repository.
    url.searchParams.delete("release");
  }
  url.searchParams.set("country", next);
  return url.toString();
}

export function selectedReleaseForCountry(
  country: Country,
  selection: CountryReleaseSelection,
): string {
  return selection.country === country ? selection.value : "";
}

function persistCountry(country: Country) {
  try {
    window.localStorage.setItem(STORAGE_KEY, country);
  } catch {
    // Ignore storage failures (private mode, etc.).
  }
}

function storedCountry(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export type UrlCountryState =
  | { kind: "country"; country: Country; persist: boolean }
  | { kind: "not_configured"; requested: string };

// The dashboard state a URL's `?country=` selects. A selectable country is
// selected (and remembered); no parameter keeps the remembered choice or the
// default; any other value is not configured, so the page shows that state
// instead of another country's release.
export function urlCountryState(
  urlValue: string | null,
  stored: string | null,
): UrlCountryState {
  const param = countryParam(urlValue);
  if (!param.configured) return { kind: "not_configured", requested: param.requested };
  if (param.explicit) return { kind: "country", country: param.country, persist: true };
  return {
    kind: "country",
    country: isSelectableCountry(stored) ? stored : DEFAULT_COUNTRY,
    persist: false,
  };
}

interface CountryContextValue {
  country: Country;
  // The URL's country code when it names no configured country; the page then
  // shows the not-configured state and `country` is only the selector's
  // fallback for navigation.
  unconfiguredCountry: string | null;
  setCountry: (country: Country) => void;
}

const CountryContext = createContext<CountryContextValue>({
  country: DEFAULT_COUNTRY,
  unconfiguredCountry: null,
  setCountry: () => {},
});

// Follows the URL's country, including client-side navigations. Kept in its
// own Suspense boundary so reading search params never suspends the pages.
function CountryUrlSync({ onUrlCountry }: { onUrlCountry: (value: string | null) => void }) {
  const urlValue = useSearchParams().get("country");
  useEffect(() => {
    onUrlCountry(urlValue);
  }, [onUrlCountry, urlValue]);
  return null;
}

export function CountryProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [country, setCountryState] = useState<Country>(DEFAULT_COUNTRY);
  const [unconfiguredCountry, setUnconfiguredCountry] = useState<string | null>(null);

  const applyUrlCountry = useCallback((urlValue: string | null) => {
    const state = urlCountryState(urlValue, storedCountry());
    if (state.kind === "not_configured") {
      setUnconfiguredCountry(state.requested);
      return;
    }
    setUnconfiguredCountry(null);
    setCountryState(state.country);
    if (state.persist) persistCountry(state.country);
  }, []);

  const setCountry = (next: Country) => {
    if (next === country && unconfiguredCountry == null) return;
    setUnconfiguredCountry(null);
    setCountryState(next);
    persistCountry(next);
    // Route through Next so server page search parameters are recalculated;
    // raw history replacement would leave initialRelease props stale.
    router.replace(countrySwitchUrl(window.location.href, next), { scroll: false });
  };

  return (
    <CountryContext.Provider value={{ country, unconfiguredCountry, setCountry }}>
      <Suspense fallback={null}>
        <CountryUrlSync onUrlCountry={applyUrlCountry} />
      </Suspense>
      {children}
    </CountryContext.Provider>
  );
}

export function useCountry(): CountryContextValue {
  return useContext(CountryContext);
}
