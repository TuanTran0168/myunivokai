"use client";

import { useEffect, useState } from "react";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";

// Every other toolbar filter — FilterSelect, DateRangeFilter — commits on
// change because a <select> or a date picker has a natural commit point.
// Free text has none, so this debounces locally rather than firing one
// request per keystroke; the parent only ever sees the settled value.
const DEBOUNCE_MS = 300;

export function SearchInput({
  value,
  onChange,
  placeholder = "Search…"
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState(value);

  // Re-seed from the committed value when it changes from outside this
  // input (e.g. a "clear filters" action elsewhere on the page).
  useEffect(() => {
    setDraft(value);
  }, [value]);

  useEffect(() => {
    if (draft === value) {
      return;
    }
    const timeout = setTimeout(() => onChange(draft), DEBOUNCE_MS);
    return () => clearTimeout(timeout);
  }, [draft, value, onChange]);

  return (
    <div className="relative flex items-center">
      <Search className="pointer-events-none absolute left-2 size-3.5 text-muted-foreground" aria-hidden="true" />
      <Input
        type="text"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="h-8 w-36 pl-7 pr-7 text-xs sm:w-48"
      />
      {draft ? (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => setDraft("")}
          className="absolute right-1.5 flex size-4 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground"
        >
          <X className="size-3" />
        </button>
      ) : null}
    </div>
  );
}
