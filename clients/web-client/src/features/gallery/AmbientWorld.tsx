"use client";

import { useMemo } from "react";
import { UniverseCanvas } from "@/components/UniverseCanvas";
import { buildPreviewSceneConfig } from "@/lib/scene";

// A calm, deterministic universe rendered as a living backdrop behind the
// gallery (and behind the glass header/footer). Reflective mood keeps motion and
// bloom low so it reads as ambient depth, not a focal scene; a cool palette sits
// quietly under the warm-black chrome.
const AMBIENT_WORLD_INPUT = {
  nickname: "Gallery",
  interests: ["Design", "Art", "Music", "Technology", "Science"],
  traits: ["calm", "curious", "creative"],
  mood: "reflective",
  preferredWorldStyle: "cosmic-galaxy",
  favoriteColors: ["#6FB3C9", "#7C5CF0", "#C9A35B"]
};

// A decorative backdrop never needs full resolution; a low dpr cap keeps this
// second WebGL context cheap on high-density screens.
const AMBIENT_DEVICE_PIXEL_RATIO_RANGE: [number, number] = [1, 1.25];

export function AmbientWorld() {
  const scene = useMemo(() => buildPreviewSceneConfig(AMBIENT_WORLD_INPUT), []);

  return (
    <div className="pointer-events-none fixed inset-0 z-0" aria-hidden="true">
      <UniverseCanvas scene={scene} className="h-full" devicePixelRatioRange={AMBIENT_DEVICE_PIXEL_RATIO_RANGE} />
      {/* Dim + vignette so foreground glass cards stay legible over the world. */}
      <div className="absolute inset-0 bg-void/55" />
      <div className="absolute inset-0 bg-[radial-gradient(120%_90%_at_50%_30%,transparent_45%,rgba(8,8,10,0.72))]" />
    </div>
  );
}
