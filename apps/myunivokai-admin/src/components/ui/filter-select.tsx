"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

// A labelled Base UI select for the toolbar filters. It lives here rather
// than beside a page because four screens use it — worlds, jobs, fleet and the
// dashboard — and it previously lived inside DashboardPage.tsx, which meant
// three pages imported a control out of a fourth page. A page is not a module
// boundary, and importing across pages is how a "small tweak to the dashboard"
// silently changes the jobs toolbar.
//
// Built on the same @base-ui/react/select primitive as select.tsx rather than
// a native <select>: these lists are short, but the native control cannot be
// styled or animated to match the rest of the toolbar, which read as flat and
// out of place next to it.
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
      <Select value={value} onValueChange={(nextValue) => onChange(nextValue ?? "")}>
        <SelectTrigger size="sm" className="text-xs">
          <SelectValue>
            {(currentValue: string) => options.find((option) => option.value === currentValue)?.label ?? options[0]?.label}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}
