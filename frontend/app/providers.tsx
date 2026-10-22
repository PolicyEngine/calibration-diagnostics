"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { useState } from "react";

import { CountryProvider } from "@/components/layout/country-context";
import { PUBLISHED_RELEASE_STALE_TIME_MS } from "@/lib/api/cache-policy";
import { countryNotConfiguredError } from "@/lib/api/client";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: PUBLISHED_RELEASE_STALE_TIME_MS,
            refetchOnWindowFocus: false,
            // A country without a configured release stays that way on a
            // retry; any other failure is retried twice.
            retry: (failureCount, error) =>
              countryNotConfiguredError(error) == null && failureCount < 2,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <CountryProvider>{children}</CountryProvider>
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  );
}
