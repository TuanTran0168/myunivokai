"use client";

// A labelled native <select> for the toolbar filters. It lives here rather
// than beside a page because four screens use it — worlds, jobs, fleet and the
// dashboard — and it previously lived inside DashboardPage.tsx, which meant
// three pages imported a control out of a fourth page. A page is not a module
// boundary, and importing across pages is how a "small tweak to the dashboard"
// silently changes the jobs toolbar.
//
// Native rather than a listbox: these are short, non-searchable lists, and the
// platform control already gets keyboard, touch and screen-reader behaviour
// right on both desktop and mobile.
export function FilterSelect({
  label,
  value,
  onChange,
  options
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly { label: string; value: string }[];
}) {
  return (
    <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <span className="sr-only sm:not-sr-only">{label}</span>
      <select
        className="h-8 cursor-pointer rounded-lg border border-border bg-transparent px-2 text-xs text-foreground outline-none focus-visible:border-ring"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value} className="bg-popover text-popover-foreground">
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
