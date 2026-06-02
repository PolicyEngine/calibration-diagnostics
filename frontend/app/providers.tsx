"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { Suspense, useState } from "react";
import { DashboardModeProvider } from "@/lib/dashboard-mode-context";
import { GeoProvider } from "@/lib/geo-context";
import { RunProvider } from "@/lib/run-context";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 5 * 60 * 1000,
            refetchOnWindowFocus: false,
            retry: 2,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <Suspense fallback={null}>
        <DashboardModeProvider>
          <RunProvider>
            <GeoProvider>{children}</GeoProvider>
          </RunProvider>
        </DashboardModeProvider>
      </Suspense>
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  );
}
