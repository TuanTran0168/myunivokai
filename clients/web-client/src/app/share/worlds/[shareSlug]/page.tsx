"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { api, apiErrorMessage } from "@/lib/api";
import type { ShareWorld } from "@/lib/types";
import { sceneFromVariant } from "@/lib/scene";
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
    <main className="grid min-h-[calc(100vh-57px)]">
      <section className="relative min-h-[620px]">
        <UniverseCanvas scene={scene} className="absolute inset-0 min-h-full" />
        <div className="relative z-10 mx-auto flex min-h-[620px] w-full max-w-7xl flex-col justify-between px-4 py-6 sm:px-6">
          <Link href="/" className="focus-ring glass-panel inline-flex w-fit items-center gap-2 rounded-md px-3 py-2 text-sm font-semibold text-on-surface">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Myunivokai
          </Link>
          <div className="max-w-2xl pb-6 text-on-surface">
            {world.archetype ? (
              <p className="mb-2 font-mono text-xs uppercase tracking-widest text-secondary">{world.archetype}</p>
            ) : null}
            <h1 className="text-4xl font-semibold tracking-normal sm:text-5xl">{world.title || "Shared universe"}</h1>
            {world.quote ? (
              <p className="mt-3 max-w-xl text-lg italic leading-7 text-on-surface">&ldquo;{world.quote}&rdquo;</p>
            ) : null}
            {world.summary ? <p className="mt-4 max-w-xl text-base leading-7 text-on-surface-variant">{world.summary}</p> : null}
          </div>
        </div>
      </section>
    </main>
  );
}
