"use client";

import { usePathname } from "next/navigation";
import { NAV_ITEMS } from "@/components/layout/nav-config";

// Dynamic page title in the sticky header, resolved from the current
// pathname against nav-config. Falls back to nothing for unknown routes
// (the header still shows the SidebarTrigger). On mobile this is the
// primary wayfinding cue since the sidebar is hidden.
export function BreadcrumbHeader() {
  const pathname = usePathname();

  // Exact match first, then prefix match for nested routes like /accounts/[id]
  const matchedItem =
    NAV_ITEMS.find((item) => item.href === pathname) ??
    NAV_ITEMS.find((item) => item.href !== "/" && pathname.startsWith(item.href));

  if (!matchedItem) return null;

  return (
    <>
      <div className="h-4 w-px bg-border" aria-hidden="true" />
      <span className="text-sm font-medium text-foreground">{matchedItem.label}</span>
    </>
  );
}
