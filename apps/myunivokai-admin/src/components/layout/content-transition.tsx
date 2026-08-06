"use client";

import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import type { ReactNode } from "react";

// Scoped to the content pane ONLY (see (dashboard)/layout.tsx) — the sidebar
// and header are siblings, outside this component, and never remount on
// navigation. Opacity-only and fast: a y-translate on a data table read as
// "wobbly" in review, and dashboards like Linear/Vercel don't move their
// chrome on every click.
export function ContentTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={pathname}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15, ease: "easeOut" }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
