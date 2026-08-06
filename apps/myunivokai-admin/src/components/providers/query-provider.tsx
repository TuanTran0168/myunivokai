"use client";

import { useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

export function QueryProvider({ children }: { children: ReactNode }) {
  // One QueryClient per browser session, created in state so it survives
  // re-renders but never leaks across requests on the server (this provider
  // only ever mounts client-side, but the pattern still matters if a future
  // page ever renders it during SSR).
  const [queryClient] = useState(() => new QueryClient());
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
