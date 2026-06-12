"use client";

import Link from "next/link";
import { Orbit, Trash2 } from "lucide-react";
import type { World } from "@/lib/types";
import { paletteFromScene, planetsFromScene, sceneFromVariant, selectedVariant } from "@/lib/scene";

const GRADIENT_STRIP_COLOR_COUNT = 3;

type SavedWorldCardProps = {
  world: World;
  onRemove: (worldIdentifier: string) => void;
};

function formatCreatedDate(createdAt?: string): string | null {
  if (!createdAt) {
    return null;
  }
  const parsedDate = new Date(createdAt);
  if (Number.isNaN(parsedDate.getTime())) {
    return null;
  }
  return parsedDate.toLocaleDateString();
}

export function SavedWorldCard({ world, onRemove }: SavedWorldCardProps) {
  const worldVariant = selectedVariant(world);
  const worldScene = sceneFromVariant(worldVariant);
  const scenePalette = paletteFromScene(worldScene);
  const planetCount = planetsFromScene(worldScene).length;
  const createdDateLabel = formatCreatedDate(world.createdAt);
  const gradientColors = scenePalette.slice(0, GRADIENT_STRIP_COLOR_COUNT).join(", ");

  return (
    <div className="glass-panel group relative overflow-hidden rounded-2xl border border-white/10 transition hover:border-white/25">
      <Link href={`/worlds/${world.id}`} className="focus-ring block">
        <div className="h-2 w-full" style={{ background: `linear-gradient(90deg, ${gradientColors})` }} />
        <div className="p-5">
          <h2 className="font-display text-lg font-semibold tracking-wide text-on-surface">
            {worldScene.sceneName || world.title || "Untitled universe"}
          </h2>
          {worldScene.archetype ? (
            <p className="mt-1 font-mono text-xs uppercase tracking-widest text-secondary">
              {worldScene.archetype}
            </p>
          ) : null}
          {worldScene.quote ? (
            <p className="mt-3 line-clamp-2 text-sm italic leading-6 text-on-surface-variant">
              &ldquo;{worldScene.quote}&rdquo;
            </p>
          ) : null}
          <div className="mt-4 flex items-center gap-4 text-xs text-on-surface-variant">
            <span className="inline-flex items-center gap-1.5">
              <Orbit className="h-3.5 w-3.5 text-secondary" aria-hidden="true" />
              {planetCount} planets
            </span>
            {createdDateLabel ? <span className="font-mono">{createdDateLabel}</span> : null}
          </div>
        </div>
      </Link>
      <button
        type="button"
        title="Remove from gallery"
        onClick={() => onRemove(world.id)}
        className="focus-ring absolute right-3 top-4 inline-flex h-8 w-8 items-center justify-center rounded-md border border-white/10 bg-surface-bright text-on-surface-variant opacity-0 transition hover:border-white/30 hover:text-on-surface group-hover:opacity-100"
      >
        <Trash2 className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}
