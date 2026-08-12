import type { LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

// One headline number with its icon and a line of context.
//
// `size` folds in what used to be a separate StatCardLite living at the bottom
// of DashboardPage: the same card at a smaller type scale for figures that are
// worth showing but are not the headline. Two components differing only in
// font size is two places to fix a padding bug.
export function StatCard({
  icon: Icon,
  label,
  value,
  hint,
  tone = "default",
  size = "default"
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "warning";
  size?: "default" | "compact";
}) {
  const compact = size === "compact";
  return (
    <Card className="card-interactive">
      <CardContent className="pt-2">
        <div className={cn("flex gap-3", compact ? "items-center gap-2.5" : "items-start")}>
          <div
            className={cn(
              "flex shrink-0 items-center justify-center rounded-lg",
              compact ? "size-7" : "size-8",
              tone === "warning" ? "bg-destructive/15" : "bg-primary/15"
            )}
          >
            <Icon className={cn("size-4", tone === "warning" ? "text-destructive" : "text-primary")} />
          </div>
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p
              className={cn(
                "mt-0.5 truncate font-heading font-semibold tabular-nums text-foreground",
                compact ? "text-sm" : "text-xl"
              )}
            >
              {value}
            </p>
            {hint ? <p className="mt-0.5 truncate text-xs text-muted-foreground">{hint}</p> : null}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
