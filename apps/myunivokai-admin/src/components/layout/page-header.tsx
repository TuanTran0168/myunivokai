import type { ReactNode } from "react";

// Title + description + primary action, rendered as plain text OUTSIDE any
// card — the Linear/Stripe pattern. v1 stuffed this into a CardHeader, which
// is why every screen read as "one big card" instead of a page.
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
    <div className="mb-6 flex items-start justify-between gap-4">
      <div>
        <h1 className="font-heading text-xl font-semibold text-foreground">{title}</h1>
        {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}
