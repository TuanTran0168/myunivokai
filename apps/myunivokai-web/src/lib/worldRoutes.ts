import type { WorldFamily } from "./types";

/**
 * Family-aware route building, in ONE place.
 *
 * Share pages are SYMMETRIC: every family sits under its own prefix,
 * /universe/share/worlds/{slug} and /nature/share/worlds/{slug}. Universe used
 * to be un-prefixed, which made the two families inconsistent and meant the
 * deploy guide's PUBLIC_WEB_URL differed in shape between services.
 *
 * The old un-prefixed /share/worlds/{slug} route was removed outright (owner
 * decision: pre-existing share links are not worth carrying). Each service's
 * PUBLIC_WEB_URL must therefore carry its family prefix, or the shareUrl it
 * prints will 404.
 *
 * World pages still use a query parameter rather than a prefix, because that
 * path is reached from inside the app rather than from a stored backend URL.
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
  return `/${family}/share/worlds/${encodeURIComponent(shareSlug)}`;
}
