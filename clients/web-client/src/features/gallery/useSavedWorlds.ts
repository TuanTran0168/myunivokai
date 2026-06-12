"use client";

import { useEffect, useState } from "react";
import { api, apiErrorMessage } from "@/lib/api";
import { readSavedWorldIdentifiers, removeWorldIdentifierFromGallery } from "@/lib/savedWorlds";
import type { World } from "@/lib/types";

export type SavedWorldEntry = {
  worldIdentifier: string;
  world?: World;
  errorMessage?: string;
};

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

    Promise.all(
      savedWorldIdentifiers.map(async (worldIdentifier): Promise<SavedWorldEntry> => {
        try {
          return { worldIdentifier, world: await api.getWorld(worldIdentifier) };
        } catch (error) {
          return { worldIdentifier, errorMessage: apiErrorMessage(error) };
        }
      })
    ).then((loadedEntries) => {
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
