/**
 * Selection helpers for the create form's chip groups, extracted verbatim from
 * app/page.tsx so their behavior can be locked by tests. Do NOT "improve" the
 * semantics here without a deliberate decision: the payload sent to the
 * backend (and therefore the deterministic preview seed) depends on them.
 */

/**
 * Toggles `item` in `current`: removing is refused at `min` items, adding is
 * refused at `max` items. Adding an already-present item is a no-op removal
 * guard, which also makes it safe for custom (free-text) entries — duplicates
 * cannot be added twice.
 */
export function toggleItem(current: string[], item: string, min: number, max: number) {
  if (current.includes(item)) {
    return current.length <= min ? current : current.filter((value) => value !== item);
  }
  return current.length >= max ? current : [...current, item];
}

/**
 * Merges `values` with `defaults`, trims, dedupes (first occurrence wins) and
 * caps at `max`.
 *
 * Locked quirk: the defaults are ALWAYS merged in, so choosing 3 non-default
 * interests submits those 3 plus the defaults (up to `max`). The create form
 * has relied on this since the beginning — the payload, preview seed, and
 * planet count all reflect it. Making the form stop inventing values is
 * tracked as refactor-plan item 4 (form-validation), not here.
 */
export function ensureRange(values: string[], defaults: string[], min: number, max: number) {
  const merged = [...values, ...defaults].map((item) => item.trim()).filter(Boolean);
  return Array.from(new Set(merged)).slice(0, max).slice(0, Math.max(min, Math.min(max, merged.length)));
}
