"use client";

import Link from "next/link";
import { Orbit, Trash2 } from "lucide-react";
import type { World } from "@/lib/types";
import { paletteFromScene, planetsFromScene, sceneFromVariant, selectedVariant } from "@/lib/scene";

const PALETTE_STRIP_COLOR_COUNT = 3;

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
  const paletteStripColors = scenePalette.slice(0, PALETTE_STRIP_COLOR_COUNT);

  return (
    <div className="glass-panel glass-lift group relative overflow-hidden rounded-2xl border border-white/10 transition hover:border-white/25">
      <Link href={`/worlds/${world.id}`} className="focus-ring block">
        {/* Palette specimen strip — solid swatches, not a gradient bar. */}
        <div className="flex h-2 w-full">
          {paletteStripColors.map((stripColor, stripIndex) => (
            <span key={stripIndex} className="h-full flex-1" style={{ backgroundColor: stripColor }} aria-hidden="true" />
          ))}
        </div>
        <div className="p-5">
          {worldScene.archetype ? (
            <p className="mb-1 font-mono text-xs uppercase tracking-[0.2em] text-brass">
              {worldScene.archetype}
            </p>
          ) : null}
          <h2 className="font-display text-lg font-semibold tracking-normal text-paper">
            {worldScene.sceneName || world.title || "Untitled universe"}
          </h2>
          {worldScene.quote ? (
            <p className="mt-3 line-clamp-2 text-sm italic leading-6 text-on-surface-variant">
              &ldquo;{worldScene.quote}&rdquo;
            </p>
          ) : null}
          <div className="mt-4 flex items-center gap-4 font-mono text-xs text-on-surface-variant">
            <span className="inline-flex items-center gap-1.5">
              <Orbit className="h-3.5 w-3.5 text-brass" aria-hidden="true" />
              {planetCount} bodies
            </span>
            {createdDateLabel ? <span>{createdDateLabel}</span> : null}
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
