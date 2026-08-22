"use client";

import type { ReactNode } from "react";
import { motion } from "motion/react";

// Title + description + primary action, rendered as plain text OUTSIDE any
// card — the Linear/Stripe pattern. v1 stuffed this into a CardHeader, which
// is why every screen read as "one big card" instead of a page.
//
// `action` is for an ACTION — a "Create account" button. Filters belong in
// FilterBar on the row below: when they lived here, the header's height
// depended on how many filters a screen had, so no two screens had the same
// title position and the app read as several apps.
export function PageHeader({
  title,
  description,
  action
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease: "easeOut" }}
      >
        <h1 className="font-heading text-xl font-semibold text-foreground">{title}</h1>
        {description ? (
          <motion.p
            className="mt-1 text-sm text-muted-foreground"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.25, delay: 0.05, ease: "easeOut" }}
          >
            {description}
          </motion.p>
        ) : null}
      </motion.div>
      {action}
    </div>
  );
}

