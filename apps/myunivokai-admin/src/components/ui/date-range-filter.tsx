"use client";

// A "since" / "until" pair of native date inputs for the toolbar filters,
// styled to match FilterSelect's <select> since they sit in the same row.
// Values are plain "YYYY-MM-DD" strings (the native <input type="date">
// format) or "" for no bound — converting that to a request's RFC3339
// instant is the caller's job, the same way each feature already converts
// its own filters into a query string.
export function DateRangeFilter({
  since,
  until,
  onSinceChange,
  onUntilChange
}: {
  since: string;
  until: string;
  onSinceChange: (value: string) => void;
  onUntilChange: (value: string) => void;
}) {
  return (
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <label className="flex items-center gap-1.5">
        <span className="sr-only sm:not-sr-only">From</span>
        <input
          type="date"
          className="h-8 cursor-pointer rounded-lg border border-border bg-transparent px-2 text-xs text-foreground outline-none focus-visible:border-ring"
          value={since}
          max={until || undefined}
          onChange={(event) => onSinceChange(event.target.value)}
        />
      </label>
      <span aria-hidden="true">–</span>
      <label className="flex items-center gap-1.5">
        <span className="sr-only sm:not-sr-only">To</span>
        <input
          type="date"
          className="h-8 cursor-pointer rounded-lg border border-border bg-transparent px-2 text-xs text-foreground outline-none focus-visible:border-ring"
          value={until}
          min={since || undefined}
          onChange={(event) => onUntilChange(event.target.value)}
        />
      </label>
    </div>
  );
}
