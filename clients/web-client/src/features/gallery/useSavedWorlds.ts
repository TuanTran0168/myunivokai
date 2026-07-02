"use client";

import { useEffect, useState } from "react";
import { api, apiErrorMessage } from "@/lib/api";
import { mapWithBoundedConcurrency } from "@/lib/concurrency";
import { readSavedWorldIdentifiers, removeWorldIdentifierFromGallery } from "@/lib/savedWorlds";
import type { World } from "@/lib/types";

export type SavedWorldEntry = {
  worldIdentifier: string;
  world?: World;
  errorMessage?: string;
};

// The fallback path fetches per world; 3 in flight stays far below the
// backend's per-IP rate-limit burst, unlike the old unbounded Promise.all
// that 429'd galleries with more than `burst` saved worlds.
const GALLERY_FETCH_CONCURRENCY_LIMIT = 3;
// Mirrors the backend's NOT_FOUND message so a world missing from the batch
// response reads the same as a single-get 404 did.
const WORLD_NOT_FOUND_MESSAGE = "The requested resource was not found.";

// Preferred path: ONE batch request for the whole gallery. If that request
// itself fails (older backend without the route, transient error), fall back
// to per-id fetches with bounded concurrency — same entries, same order.
async function loadSavedWorldEntries(savedWorldIdentifiers: string[]): Promise<SavedWorldEntry[]> {
  try {
    const worlds = await api.getWorldsByIds(savedWorldIdentifiers);
    const worldsById = new Map(worlds.map((world) => [world.id, world]));
    return savedWorldIdentifiers.map((worldIdentifier) => {
      const world = worldsById.get(worldIdentifier);
      return world ? { worldIdentifier, world } : { worldIdentifier, errorMessage: WORLD_NOT_FOUND_MESSAGE };
    });
  } catch {
    return mapWithBoundedConcurrency(
      savedWorldIdentifiers,
      GALLERY_FETCH_CONCURRENCY_LIMIT,
      async (worldIdentifier): Promise<SavedWorldEntry> => {
        try {
          return { worldIdentifier, world: await api.getWorld(worldIdentifier) };
        } catch (error) {
          return { worldIdentifier, errorMessage: apiErrorMessage(error) };
        }
      }
    );
  }
}

export function useSavedWorlds() {
  const [savedWorldEntries, setSavedWorldEntries] = useState<SavedWorldEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;
    const savedWorldIdentifiers = readSavedWorldIdentifiers();
    if (savedWorldIdentifiers.length === 0) {
      setIsLoading(false);
      return;
    }

    loadSavedWorldEntries(savedWorldIdentifiers).then((loadedEntries) => {
      if (!isMounted) {
        return;
      }
      setSavedWorldEntries(loadedEntries);
      setIsLoading(false);
    });

    return () => {
      isMounted = false;
    };
  }, []);

  function removeSavedWorld(worldIdentifier: string) {
    removeWorldIdentifierFromGallery(worldIdentifier);
    setSavedWorldEntries((currentEntries) =>
      currentEntries.filter((entry) => entry.worldIdentifier !== worldIdentifier)
    );
  }

  return { savedWorldEntries, isLoading, removeSavedWorld };
}
