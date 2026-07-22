import type { WorldFamily } from "./types";

/**
 * Family-aware route building, in ONE place. Universe keeps its historical
 * URLs (no query, no prefix) so every existing bookmark and share link still
 * works; nature worlds carry the family as a query parameter on the world
 * page and live under the /nature prefix on the share page (nature-service's
 * PUBLIC_WEB_URL is configured with that prefix, so the shareUrl the backend
 * prints resolves to the right page with zero backend changes).
 */

export const WORLD_FAMILY_QUERY_PARAMETER = "family";

export function worldFamilyFromQueryValue(value: string | null | undefined): WorldFamily {
  return value === "nature" ? "nature" : "universe";
}

export function worldPagePath(worldIdentifier: string, family: WorldFamily): string {
  const basePath = `/worlds/${encodeURIComponent(worldIdentifier)}`;
  return family === "nature" ? `${basePath}?${WORLD_FAMILY_QUERY_PARAMETER}=nature` : basePath;
}

export function sharePagePath(shareSlug: string, family: WorldFamily): string {
  const encodedSlug = encodeURIComponent(shareSlug);
  return family === "nature" ? `/nature/share/worlds/${encodedSlug}` : `/share/worlds/${encodedSlug}`;
}
