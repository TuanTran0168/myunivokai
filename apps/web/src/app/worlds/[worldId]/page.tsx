"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Copy, ExternalLink, Loader2, Plus, Rocket } from "lucide-react";
import { api, apiErrorMessage } from "@/lib/api";
import { sceneFromVariant, selectedVariant } from "@/lib/scene";
import type { World, WorldVariant } from "@/lib/types";
import { StatusMessage } from "@/components/StatusMessage";
import { UniverseCanvas } from "@/components/UniverseCanvas";
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
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState<"variant" | "publish" | "select" | "copy" | null>(null);

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

  async function regenerateVariant() {
    setAction("variant");
    setError("");
    setNotice("");
    try {
      const variant = await api.regenerateVariant(params.worldId);
      await loadWorld();
      setActiveVariantId(variant.id);
      setNotice("Variant created.");
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setAction(null);
    }
  }

  async function selectCurrentVariant(variant: WorldVariant) {
    setAction("select");
    setError("");
    setNotice("");
    setActiveVariantId(variant.id);
    try {
      await api.selectVariant(params.worldId, variant.id);
      await loadWorld();
      setNotice("Variant selected.");
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setAction(null);
    }
  }

  async function publishWorld() {
    setAction("publish");
    setError("");
    setNotice("");
    try {
      const nextWorld = await api.publishWorld(params.worldId);
      setWorld(nextWorld.shareSlug ? nextWorld : await api.getWorld(params.worldId));
      setNotice("World published.");
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setAction(null);
    }
  }

  async function copyShareLink() {
    if (!world?.shareSlug) {
      return;
    }
    setAction("copy");
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/share/worlds/${world.shareSlug}`);
      setNotice("Share link copied.");
    } catch {
      setNotice("Share link ready.");
    } finally {
      setAction(null);
    }
  }

  if (loading) {
    return (
      <main className="mx-auto grid min-h-[calc(100vh-57px)] w-full max-w-7xl place-items-center px-4 py-6">
        <StatusMessage tone="loading">Loading world...</StatusMessage>
      </main>
    );
  }

  if (!world) {
    return (
      <main className="mx-auto grid min-h-[calc(100vh-57px)] w-full max-w-7xl place-items-center px-4 py-6">
        <StatusMessage tone="error">{error || "World not found"}</StatusMessage>
      </main>
    );
  }

  return (
    <main className="relative mx-auto grid w-full max-w-7xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[1fr_360px]">
      <section className="grid gap-4">
        <div className="min-h-[460px] overflow-hidden rounded-2xl border border-white/10 shadow-cyan">
          <UniverseCanvas scene={sceneFromVariant(activeVariant)} className="h-full" />
        </div>
        <div className="glass-panel rounded-2xl p-5">
          <h1 className="font-display text-2xl font-semibold tracking-wide text-primary">{world.title || "Untitled universe"}</h1>
          {world.summary ? <p className="mt-2 text-sm leading-6 text-on-surface-variant">{world.summary}</p> : null}
        </div>
      </section>

      <aside className="grid content-start gap-4">
        {error ? <StatusMessage tone="error">{error}</StatusMessage> : null}
        {notice ? <StatusMessage>{notice}</StatusMessage> : null}
        <div className="glass-panel rounded-2xl p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="font-display text-base font-semibold text-on-surface">Variants</h2>
            <button
              type="button"
              onClick={regenerateVariant}
              disabled={action !== null}
              title="Create variant"
              className="focus-ring inline-flex h-9 w-9 items-center justify-center rounded-md border border-white/10 bg-surface-bright text-on-surface hover:border-white/25 disabled:opacity-45"
            >
              {action === "variant" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Plus className="h-4 w-4" aria-hidden="true" />}
            </button>
          </div>
          {world.variants.length ? (
            <VariantList world={world} activeVariantId={activeVariant?.id} busyVariantId={action === "select" ? activeVariant?.id : undefined} onSelect={selectCurrentVariant} />
          ) : (
            <p className="text-sm text-on-surface-variant">No variants yet.</p>
          )}
        </div>

        <div className="glass-panel rounded-2xl p-4">
          <h2 className="mb-3 font-display text-base font-semibold text-on-surface">Publish</h2>
          <div className="grid gap-2">
            <button
              type="button"
              onClick={publishWorld}
              disabled={action !== null}
              className="focus-ring btn-gradient inline-flex min-h-10 items-center justify-center gap-2 rounded-md px-3 py-2 font-semibold disabled:opacity-45"
            >
              {action === "publish" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Rocket className="h-4 w-4" aria-hidden="true" />}
              Publish
            </button>
            {world.shareSlug ? (
              <div className="grid grid-cols-[1fr_auto_auto] items-center gap-2 rounded-md border border-white/10 bg-surface-low p-2">
                <span className="truncate text-sm text-on-surface-variant">/share/worlds/{world.shareSlug}</span>
                <button type="button" title="Copy" onClick={copyShareLink} className="focus-ring inline-flex h-9 w-9 items-center justify-center rounded-md bg-surface-bright text-on-surface">
                  {action === "copy" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
                </button>
                <Link href={`/share/worlds/${world.shareSlug}`} title="Open" className="focus-ring inline-flex h-9 w-9 items-center justify-center rounded-md bg-surface-bright text-on-surface">
                  <ExternalLink className="h-4 w-4" aria-hidden="true" />
                </Link>
              </div>
            ) : null}
          </div>
        </div>
      </aside>
    </main>
  );
}
