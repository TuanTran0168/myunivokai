"use client";

import { useLinkStatus } from "next/link";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

// An immediate acknowledgement that a link was clicked.
//
// loading.tsx fixes the half of the stall that is "the old page stayed put
// while the new one rendered", but it cannot fix the first moments: the router
// has to fetch the route's payload before anything of the new page — including
// its own loading boundary — can be committed. useLinkStatus is the only thing
// that knows about the click before then, and it only works when rendered
// *inside* the <Link> it reports on.
//
// The delay built into .link-pending is why this does not turn every click
// into a flicker: a navigation that resolves inside 150ms unmounts the spinner
// before its fade-in starts, so a fast click looks exactly as it did before,
// and only a slow one grows an indicator.
export function LinkPending({ className }: { className?: string }) {
  const { pending } = useLinkStatus();
  if (!pending) {
    return null;
  }
  return <Loader2 aria-hidden="true" className={cn("link-pending size-3.5 shrink-0", className)} />;
}
