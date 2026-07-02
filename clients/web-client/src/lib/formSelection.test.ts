import { describe, expect, it } from "vitest";
import { ensureRange, toggleItem } from "./formSelection";

describe("toggleItem", () => {
  it("adds an item below the maximum and removes it above the minimum", () => {
    expect(toggleItem(["a", "b", "c"], "d", 3, 8)).toEqual(["a", "b", "c", "d"]);
    expect(toggleItem(["a", "b", "c", "d"], "d", 3, 8)).toEqual(["a", "b", "c"]);
  });

  it("refuses to remove below the minimum and to add above the maximum", () => {
    expect(toggleItem(["a", "b", "c"], "a", 3, 8)).toEqual(["a", "b", "c"]);
    expect(toggleItem(["a", "b", "c", "d"], "e", 3, 4)).toEqual(["a", "b", "c", "d"]);
  });

  it("never duplicates an already-selected item (safe for custom entries)", () => {
    const selection = ["a", "b", "c", "Cooking"];
    expect(toggleItem(selection, "Cooking", 3, 8)).toEqual(["a", "b", "c"]);
  });
});

describe("ensureRange (behavior lock — see formSelection.ts)", () => {
  const defaults = ["Technology", "Design", "AI"];

  it("returns the defaults when nothing is selected", () => {
    expect(ensureRange([], defaults, 3, 8)).toEqual(defaults);
  });

  it("locks the quirk: defaults are always merged after the selection", () => {
    expect(ensureRange(["Music", "Art", "Science"], defaults, 3, 8)).toEqual([
      "Music",
      "Art",
      "Science",
      "Technology",
      "Design",
      "AI"
    ]);
  });

  it("dedupes with first occurrence winning and trims whitespace", () => {
    expect(ensureRange([" Technology ", "Music", ""], defaults, 3, 8)).toEqual([
      "Technology",
      "Music",
      "Design",
      "AI"
    ]);
  });

  it("caps the merged list at the maximum", () => {
    const eightSelections = ["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8"];
    expect(ensureRange(eightSelections, defaults, 3, 8)).toEqual(eightSelections);
  });
});
