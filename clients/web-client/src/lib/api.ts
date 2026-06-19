import type { ApiErrorPayload, CreateWorldInput, PublishResult, ShareWorld, World, WorldVariant } from "./types";

const API_BASE_URL = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8080/api/v1").replace(/\/$/, "");

export class ApiError extends Error {
  code: string;
  details: unknown[];
  requestId?: string;
  status: number;

  constructor(status: number, payload: ApiErrorPayload) {
    const error = payload.error ?? {};
    super(error.message || `Request failed with status ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.code = error.code || "request_failed";
    this.details = error.details || [];
    this.requestId = error.requestId;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {})
    },
    cache: "no-store"
  });

  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};

  if (!response.ok) {
    throw new ApiError(response.status, payload);
  }

  return payload as T;
}

function normalizeVariant(raw: any): WorldVariant {
  const sceneConfig = raw.sceneConfig ?? raw.scene_config ?? raw.scene ?? raw.config;
  return {
    id: String(raw.id ?? raw.variantId ?? raw.variant_id ?? ""),
    worldId: raw.worldId ?? raw.world_id,
    name: raw.name,
    title: raw.title,
    seed: raw.seed ?? sceneConfig?.seed,
    sceneConfig,
    selected: Boolean(raw.selected ?? raw.isSelected ?? raw.is_selected),
    createdAt: raw.createdAt ?? raw.created_at
  };
}

function normalizeWorld(raw: any): World {
  const world = raw.world ?? raw.data ?? raw;
  // GET /worlds/{id} returns { world, selectedVariant, variants } with the
  // variant list at the response root; POST /worlds returns { world, variant }.
  const variantListRaw =
    raw.variants ?? world.variants ?? world.worldVariants ?? world.world_variants ?? [];
  const singleVariantRaw = raw.variant ?? raw.selectedVariant ?? raw.selected_variant;
  const variantsRaw =
    Array.isArray(variantListRaw) && variantListRaw.length
      ? variantListRaw
      : singleVariantRaw
        ? [singleVariantRaw]
        : [];
  const selectedVariantIdRaw =
    world.selectedVariantId ?? world.selected_variant_id ?? raw.selectedVariant?.id ?? raw.selected_variant?.id;
  return {
    id: String(world.id ?? world.worldId ?? world.world_id ?? ""),
    title: world.title ?? world.name ?? world.sceneName ?? world.scene_name ?? world.nickname,
    summary: world.summary ?? world.description ?? world.shortNarrative ?? world.short_narrative ?? world.quote,
    status: world.status ?? world.visibility,
    shareSlug: world.shareSlug ?? world.share_slug,
    selectedVariantId: selectedVariantIdRaw,
    variants: variantsRaw.map(normalizeVariant).filter((variant) => variant.id),
    createdAt: world.createdAt ?? world.created_at,
    publishedAt: world.publishedAt ?? world.published_at
  };
}

function normalizeShare(raw: any): ShareWorld {
  const publicWorld = raw.world ?? raw.data ?? raw;
  const variantRaw =
    raw.variant ?? publicWorld.variant ?? publicWorld.selectedVariant ?? publicWorld.selected_variant;
  const variant = variantRaw ? normalizeVariant(variantRaw) : undefined;
  return {
    id: String(publicWorld.id ?? publicWorld.worldId ?? publicWorld.world_id ?? ""),
    title:
      publicWorld.title ??
      publicWorld.name ??
      publicWorld.sceneName ??
      publicWorld.scene_name ??
      publicWorld.nickname,
    summary:
      publicWorld.summary ??
      publicWorld.description ??
      publicWorld.shortNarrative ??
      publicWorld.short_narrative,
    quote: publicWorld.quote,
    archetype: publicWorld.archetype,
    shareSlug: publicWorld.shareSlug ?? publicWorld.share_slug,
    variant,
    publishedAt: publicWorld.publishedAt ?? publicWorld.published_at
  };
}

export const api = {
  async createWorld(input: CreateWorldInput): Promise<World> {
    return normalizeWorld(
      await request<unknown>("/worlds", {
        method: "POST",
        body: JSON.stringify(input)
      })
    );
  },

  async getWorld(worldId: string): Promise<World> {
    return normalizeWorld(await request<unknown>(`/worlds/${worldId}`));
  },

  async regenerateVariant(worldId: string): Promise<WorldVariant> {
    const payload: any = await request<unknown>(`/worlds/${worldId}/variants`, { method: "POST", body: "{}" });
    return normalizeVariant(payload.variant ?? payload.data ?? payload);
  },

  async selectVariant(worldId: string, variantId: string): Promise<World> {
    return normalizeWorld(
      await request<unknown>(`/worlds/${worldId}/variants/${variantId}/select`, { method: "POST", body: "{}" })
    );
  },

  async publishWorld(worldId: string): Promise<PublishResult> {
    const payload = await request<{ shareSlug?: string; shareUrl?: string; share_slug?: string }>(
      `/worlds/${worldId}/publish`,
      { method: "POST", body: "{}" }
    );
    return { shareSlug: payload.shareSlug ?? payload.share_slug ?? "", shareUrl: payload.shareUrl ?? "" };
  },

  async getShareWorld(shareSlug: string): Promise<ShareWorld> {
    return normalizeShare(await request<unknown>(`/share/worlds/${shareSlug}`));
  }
};

function validationDetailMessages(details: unknown[]): string[] {
  return details
    .map((detail) => {
      if (detail && typeof detail === "object" && "message" in detail) {
        const message = (detail as { message?: unknown }).message;
        return typeof message === "string" ? message : "";
      }
      return "";
    })
    .filter((message) => message.length > 0);
}

export function apiErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    // Surface the backend's field-level validation messages (e.g. "Goal must be
    // 10-220 characters.") instead of the generic "Please check the highlighted
    // fields." so the user can see exactly what to fix.
    const detailMessages = validationDetailMessages(error.details);
    const baseMessage = detailMessages.length > 0 ? detailMessages.join(" ") : error.message;
    return error.requestId ? `${baseMessage} (${error.requestId})` : baseMessage;
  }
  if (error instanceof Error) {
    if (error.message === "Failed to fetch" || error.message.toLowerCase().includes("fetch failed")) {
      return `Backend is not reachable at ${API_BASE_URL}. Start the API, then try Generate again.`;
    }
    return error.message;
  }
  return "Something went wrong";
}
