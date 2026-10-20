import { NextResponse } from "next/server";

import {
  CountryNotConfiguredError,
  countryParam,
  type MicrocosmCountry,
} from "@policyengine/calibration-tree/countries";

// The country a dashboard API request names (`?country=`, absent → the
// registry default), or the explicit not-configured response when the code
// has no configured release. Routes return that response before reading any
// artifact, so an unknown code never reaches a loader and is never answered
// with another country's release.
export function requestedCountry(
  searchParams: URLSearchParams,
): MicrocosmCountry | NextResponse {
  const param = countryParam(searchParams.get("country"));
  if (param.configured) return param.country;
  return countryNotConfiguredResponse(new CountryNotConfiguredError(param.requested));
}

// For routes whose artifacts are addressed per country, which take no default:
// a missing parameter is a malformed request (400), not the default country.
export function requiredCountry(
  searchParams: URLSearchParams,
): MicrocosmCountry | NextResponse {
  if (!searchParams.get("country")) {
    return NextResponse.json(
      { detail: "Provide a calibration country via ?country=." },
      { status: 400 },
    );
  }
  return requestedCountry(searchParams);
}

export function countryNotConfiguredResponse(
  error: CountryNotConfiguredError,
): NextResponse {
  return NextResponse.json(error.body(), { status: 404 });
}
