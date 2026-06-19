"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowRight } from "lucide-react";
import { api, apiErrorMessage } from "@/lib/api";
import type { ShareWorld } from "@/lib/types";
import { planetsFromScene, sceneFromVariant } from "@/lib/scene";
import { UniverseCanvas } from "@/components/UniverseCanvas";
import { StatusMessage } from "@/components/StatusMessage";

type PageProps = {
  params: {
    shareSlug: string;
  };
};

export default function ShareWorldPage({ params }: PageProps) {
  const [world, setWorld] = useState<ShareWorld | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    api
      .getShareWorld(params.shareSlug)
      .then((nextWorld) => mounted && setWorld(nextWorld))
      .catch((err) => mounted && setError(apiErrorMessage(err)))
      .finally(() => mounted && setLoading(false));

    return () => {
      mounted = false;
    };
  }, [params.shareSlug]);

  const scene = useMemo(() => sceneFromVariant(world?.variant), [world]);
  const planets = useMemo(() => planetsFromScene(scene), [scene]);

  if (loading) {
    return (
      <main className="mx-auto grid min-h-[calc(100vh-57px)] w-full max-w-7xl place-items-center px-4 py-6">
        <StatusMessage tone="loading">Loading shared world...</StatusMessage>
      </main>
    );
  }

  if (!world) {
    return (
      <main className="mx-auto grid min-h-[calc(100vh-57px)] w-full max-w-7xl place-items-center px-4 py-6">
        <StatusMessage tone="error">{error || "Shared world not found"}</StatusMessage>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-container-max px-margin-mobile py-12 md:px-margin-desktop lg:py-16">
      {/* Hero: title + archetype + the live universe in a glass frame */}
      <section className="relative mb-16">
        <div className="pointer-events-none absolute left-1/2 top-1/2 -z-10 h-[60vw] max-h-[640px] w-[60vw] max-w-[640px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/20 blur-[120px]" />
        <div className="mb-10 text-center">
          {world.archetype ? (
            <p className="mb-3 font-mono text-xs uppercase tracking-[0.2em] text-secondary">{world.archetype}</p>
          ) : null}
          <h1 className="font-display text-4xl font-bold tracking-wide text-on-surface drop-shadow-[0_0_10px_rgba(255,255,255,0.15)] sm:text-5xl">
            {world.title || "Shared universe"}
          </h1>
          {world.quote ? (
            <p className="mx-auto mt-4 max-w-2xl text-lg italic leading-8 text-on-surface-variant">&ldquo;{world.quote}&rdquo;</p>
          ) : null}
        </div>

        <div className="glass-panel glass-panel-glow relative h-[clamp(320px,60vh,680px)] overflow-hidden rounded-2xl">
          <UniverseCanvas scene={scene} className="h-full" />
        </div>

        {world.summary ? (
          <p className="mx-auto mt-8 max-w-2xl text-center text-base leading-7 text-on-surface-variant">{world.summary}</p>
        ) : null}
      </section>

      {/* Celestial Bodies: the world's planets, each with its meaning */}
      {planets.length ? (
        <section className="mb-16">
          <h2 className="mb-8 inline-block border-b border-white/10 pb-3 font-display text-2xl font-semibold text-secondary">
            Celestial Bodies
          </h2>
          <div className="grid gap-4">
            {planets.map((planet, index) => (
              <div
                key={`${planet.key ?? planet.name ?? "body"}-${index}`}
                className="glass-panel flex items-center gap-5 rounded-2xl p-5 transition-colors hover:border-white/20"
              >
                <span
                  className="h-14 w-14 flex-shrink-0 rounded-full shadow-[0_0_15px_rgba(208,188,255,0.25)]"
                  style={{ background: `radial-gradient(circle at 30% 30%, ${planet.color ?? "#a078ff"}, #0e1323)` }}
                  aria-hidden="true"
                />
                <div>
                  <h3 className="font-display text-lg font-semibold text-on-surface">{planet.name ?? `Body ${index + 1}`}</h3>
                  {planet.meaning ? (
                    <p className="mt-1 text-sm leading-6 text-on-surface-variant">{planet.meaning}</p>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/* Closing CTA */}
      <section className="relative py-16 text-center">
        <div className="pointer-events-none absolute inset-0 -z-10 bg-gradient-to-b from-transparent to-primary/10" />
        <h2 className="mx-auto max-w-2xl font-display text-3xl font-bold tracking-wide text-on-surface sm:text-4xl">
          Inspired by what you see?
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-base leading-7 text-on-surface-variant">
          Every mind has a unique architecture. Uncover your traits and build your own digital cosmos.
        </p>
        <Link
          href="/"
          className="focus-ring btn-gradient mt-8 inline-flex items-center gap-2 rounded-full px-8 py-3.5 font-semibold"
        >
          Create Your Own Universe
          <ArrowRight className="h-5 w-5" aria-hidden="true" />
        </Link>
      </section>
    </main>
  );
}
