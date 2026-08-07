"use client";

import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import type { ReactNode } from "react";

// Scoped to the content pane ONLY (see (dashboard)/layout.tsx) — the sidebar
// and header are siblings, outside this component, and never remount on
// navigation. Opacity + a tiny y-shift (6px, not 16px — the original was
// rejected as "wobbly"). Dashboards like Linear/Vercel don't move their
// chrome on every click, but a small y-translate on the content pane reads
// as a natural page settling into place.
export function ContentTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={pathname}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -4 }}
        transition={{ duration: 0.18, ease: "easeOut" }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}

