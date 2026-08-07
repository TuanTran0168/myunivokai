import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

// Centered empty-state treatment: an icon, a title, and an optional
// description. Used for zero-result tables ("No events yet"), placeholder
// pages ("Coming in S4-ANALYTICS-007"), and any future zero-state screens.
export function EmptyState({
  icon: Icon,
  title,
  description,
  className
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-3 py-12 text-center", className)}>
      <div className="flex size-12 items-center justify-center rounded-xl bg-muted">
        <Icon className="size-6 text-muted-foreground" />
      </div>
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        {description ? <p className="max-w-xs text-sm text-muted-foreground">{description}</p> : null}
      </div>
    </div>
  );
}
