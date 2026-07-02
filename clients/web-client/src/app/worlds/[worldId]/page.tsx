"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Copy, Download, ExternalLink, Loader2, RefreshCw, Rocket } from "lucide-react";
import { toast } from "sonner";
import { api, apiErrorMessage } from "@/lib/api";
import { exportSceneCanvasAsPng } from "@/lib/exportImage";
import { addWorldIdentifierToGallery } from "@/lib/savedWorlds";
import { planetsFromScene, sceneFromVariant, selectedVariant } from "@/lib/scene";
import type { PlanetSceneConfig, World, WorldVariant } from "@/lib/types";
import { StatusMessage } from "@/components/StatusMessage";
import { PlanetDetailsPanel } from "@/components/PlanetDetailsPanel";
import { UniverseCanvas, planetIdentityKey } from "@/components/UniverseCanvas";
import { VariantList } from "@/components/VariantList";

type PageProps = {
  params: {
    worldId: string;
  };
};

export default function WorldPage({ params }: PageProps) {
  const [world, setWorld] = useState<World | null>(null);
  const [activeVariantId, setActiveVariantId] = useState<string>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState<"variant" | "publish" | "select" | "copy" | null>(null);
  const [selectedPlanetKey, setSelectedPlanetKey] = useState<string | null>(null);
  const sceneContainerReference = useRef<HTMLDivElement>(null);

  async function loadWorld() {
    setError("");
    const nextWorld = await api.getWorld(params.worldId);
    setWorld(nextWorld);
    const active = selectedVariant(nextWorld);
    setActiveVariantId((current) => current || active?.id);
  }

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    api
      .getWorld(params.worldId)
      .then((nextWorld) => {
        if (!mounted) {
          return;
        }
        setWorld(nextWorld);
        setActiveVariantId(selectedVariant(nextWorld)?.id);
        addWorldIdentifierToGallery(nextWorld.id);
      })
      .catch((err) => mounted && setError(apiErrorMessage(err)))
      .finally(() => mounted && setLoading(false));

    return () => {
      mounted = false;
    };
  }, [params.worldId]);

  const activeVariant = useMemo(() => {
    if (!world) {
      return undefined;
    }
    return world.variants.find((variant) => variant.id === activeVariantId) ?? selectedVariant(world);
  }, [activeVariantId, world]);

  const activeScene = useMemo(() => sceneFromVariant(activeVariant), [activeVariant]);
  const activeScenePlanets = useMemo(() => planetsFromScene(activeScene), [activeScene]);

  useEffect(() => {
    setSelectedPlanetKey(null);
  }, [activeVariantId]);

  function handleSelectPlanet(planet: PlanetSceneConfig | null) {
    if (!planet) {
      setSelectedPlanetKey(null);
      return;
    }
    const planetIndex = activeScenePlanets.indexOf(planet);
    setSelectedPlanetKey(planetIdentityKey(planet, planetIndex));
  }

  async function regenerateVariant() {
    setAction("variant");
    try {
      const variant = await api.regenerateVariant(params.worldId);
      await loadWorld();
      setActiveVariantId(variant.id);
      toast.success("Variant created.");
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setAction(null);
    }
  }

  async function selectCurrentVariant(variant: WorldVariant) {
    setAction("select");
    setActiveVariantId(variant.id);
    try {
      await api.selectVariant(params.worldId, variant.id);
      await loadWorld();
      toast.success("Variant selected.");
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setAction(null);
    }
  }

  async function publishWorld() {
    setAction("publish");
    try {
      await api.publishWorld(params.worldId);
      // Publish returns only the share slug, not a full world. Re-fetch so the
      // world keeps its variants/planets (otherwise the canvas falls back to the
      // abstract renderer) and picks up the new shareSlug.
      await loadWorld();
      toast.success("World published.");
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setAction(null);
    }
  }

  function exportSceneImage() {
    const exportFileName = `myunivokai-${activeScene.sceneName ?? world?.id ?? "universe"}`;
    const exportSucceeded = exportSceneCanvasAsPng(sceneContainerReference.current, exportFileName);
    if (exportSucceeded) {
      toast.success("Image exported.");
    } else {
      toast.error("Could not export image.");
    }
  }

  async function copyShareLink() {
    if (!world?.shareSlug) {
      return;
    }
    setAction("copy");
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/share/worlds/${world.shareSlug}`);
      toast.success("Share link copied.");
    } catch {
      toast("Share link ready.");
    } finally {
      setAction(null);
    }
  }

  if (loading) {
    return (
      <main className="mx-auto grid min-h-screen w-full max-w-7xl place-items-center px-4 pt-[57px]">
        <StatusMessage tone="loading">Loading world...</StatusMessage>
      </main>
    );
  }

  if (!world) {
    return (
      <main className="mx-auto grid min-h-screen w-full max-w-7xl place-items-center px-4 pt-[57px]">
        <StatusMessage tone="error">{error || "World not found"}</StatusMessage>
      </main>
    );
  }

  return (
    <main className="relative flex min-h-screen flex-col lg:block lg:h-screen lg:overflow-hidden">
      {/* Full-bleed solar system: an in-flow hero on mobile, the command-deck
          background on desktop (bleeds behind the glass header). The ref wraps
          the canvas so Export captures it. */}
      <div ref={sceneContainerReference} className="relative h-[48vh] w-full lg:absolute lg:inset-0 lg:h-full">
        <UniverseCanvas
          scene={activeScene}
          className="h-full"
          selectedPlanetKey={selectedPlanetKey}
          onSelectPlanet={handleSelectPlanet}
          preserveDrawingBuffer
        />
      </div>

      {/* HUD overlay — a normal scrolling column on mobile; on desktop it becomes
          a pointer-transparent layer so orbit-drag passes through the gaps, while
          each glass island re-enables pointer events. */}
      <div className="relative z-10 flex flex-1 flex-col gap-4 p-4 sm:p-6 lg:pointer-events-none lg:absolute lg:inset-x-0 lg:bottom-0 lg:top-[57px]">
        <div className="flex flex-1 flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          {/* Left island: identity + variants */}
          <div className="pointer-events-auto flex w-full flex-col gap-4 lg:max-h-full lg:w-[320px] lg:min-h-0 lg:overflow-y-auto">
            <div className="glass-panel glass-panel-glow glass-rise rounded-2xl p-5">
              {activeScene.archetype ? (
                <p className="mb-1 font-mono text-xs uppercase tracking-[0.2em] text-brass">{activeScene.archetype}</p>
              ) : null}
              <h1 className="font-display text-2xl font-semibold tracking-normal text-paper">
                {activeScene.sceneName || world.title || "Untitled universe"}
              </h1>
              {world.nickname ? (
                <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.18em] text-grey">
                  A portrait of {world.nickname}
                </p>
              ) : null}
              {activeScene.quote ? (
                <p className="mt-2 text-sm italic leading-6 text-on-surface">&ldquo;{activeScene.quote}&rdquo;</p>
              ) : null}
              {world.summary ? <p className="mt-2 text-sm leading-6 text-on-surface-variant">{world.summary}</p> : null}
            </div>

            <div className="glass-panel rounded-2xl p-4">
              <h2 className="mb-3 font-display text-base font-semibold text-on-surface">Variants</h2>
              {world.variants.length ? (
                <VariantList
                  world={world}
                  activeVariantId={activeVariant?.id}
                  busyVariantId={action === "select" ? activeVariant?.id : undefined}
                  onSelect={selectCurrentVariant}
                />
              ) : (
                <p className="text-sm text-on-surface-variant">No variants yet.</p>
              )}
            </div>
          </div>

          {/* Right island: World DNA (planets) + share */}
          <div className="pointer-events-auto flex w-full flex-col gap-4 lg:max-h-full lg:w-[340px] lg:min-h-0 lg:overflow-y-auto">
            <PlanetDetailsPanel
              planets={activeScenePlanets}
              selectedPlanetKey={selectedPlanetKey}
              onSelectPlanet={handleSelectPlanet}
            />
            {world.shareSlug ? (
              <div className="glass-panel rounded-2xl p-4">
                <h2 className="mb-3 font-display text-base font-semibold text-on-surface">Share</h2>
                <div className="grid grid-cols-[1fr_auto_auto] items-center gap-2 rounded-md border border-white/10 bg-surface-low p-2">
                  <span className="truncate text-sm text-on-surface-variant">/share/worlds/{world.shareSlug}</span>
                  <button
                    type="button"
                    title="Copy link"
                    aria-label="Copy share link"
                    onClick={copyShareLink}
                    className="focus-ring inline-flex h-9 w-9 items-center justify-center rounded-md bg-surface-bright text-on-surface"
                  >
                    {action === "copy" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
                  </button>
                  <Link
                    href={`/share/worlds/${world.shareSlug}`}
                    title="Open share page"
                    aria-label="Open share page"
                    className="focus-ring inline-flex h-9 w-9 items-center justify-center rounded-md bg-surface-bright text-on-surface"
                  >
                    <ExternalLink className="h-4 w-4" aria-hidden="true" />
                  </Link>
                </div>
              </div>
            ) : null}
          </div>
        </div>

        {/* Bottom-center action toolbar */}
        <div className="pointer-events-auto mx-auto">
          <div className="glass-panel glass-panel-glow glass-rise flex flex-wrap items-center justify-center gap-2 rounded-2xl p-2">
            <button
              type="button"
              onClick={regenerateVariant}
              disabled={action !== null}
              className="focus-ring inline-flex min-h-10 items-center gap-2 rounded-xl border border-white/10 bg-surface-bright px-4 py-2 text-sm text-on-surface tappable hover:border-white/25 disabled:opacity-45"
            >
              {action === "variant" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-4 w-4" aria-hidden="true" />}
              Regenerate Variant
            </button>
            <button
              type="button"
              onClick={exportSceneImage}
              className="focus-ring inline-flex min-h-10 items-center gap-2 rounded-xl border border-white/10 bg-surface-bright px-4 py-2 text-sm text-on-surface tappable hover:border-white/25"
            >
              <Download className="h-4 w-4" aria-hidden="true" />
              Export Image
            </button>
            <button
              type="button"
              onClick={publishWorld}
              disabled={action !== null}
              className="focus-ring btn-gradient inline-flex min-h-10 items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold disabled:opacity-45"
            >
              {action === "publish" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Rocket className="h-4 w-4" aria-hidden="true" />}
              {world.shareSlug ? "Re-publish" : "Publish"}
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
