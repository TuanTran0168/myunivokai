import type { Metadata } from "next";
import { ShareWorldView } from "./ShareWorldView";

type PageProps = {
  params: {
    shareSlug: string;
  };
};

const API_BASE_URL = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8080/api/v1").replace(/\/$/, "");

// Social crawlers read metadata server-side; cache it so a popular share link
// does not hammer the API, and bail out fast when the API is cold so the page
// itself never waits on a slow metadata fetch.
const METADATA_REVALIDATE_SECONDS = 300;
const METADATA_FETCH_TIMEOUT_MILLISECONDS = 3000;

const FALLBACK_PAGE_TITLE = "A personal universe — Myunivokai";
const FALLBACK_PAGE_DESCRIPTION =
  "A one-of-a-kind 3D universe generated from a personality. Explore it, then create your own.";

type ShareWorldMetadataPayload = {
  world?: {
    nickname?: string;
    archetype?: string;
    sceneName?: string;
    quote?: string;
    shortNarrative?: string;
  };
};

async function fetchShareWorldForMetadata(shareSlug: string): Promise<ShareWorldMetadataPayload | null> {
  try {
    const response = await fetch(`${API_BASE_URL}/share/worlds/${encodeURIComponent(shareSlug)}`, {
      next: { revalidate: METADATA_REVALIDATE_SECONDS },
      signal: AbortSignal.timeout(METADATA_FETCH_TIMEOUT_MILLISECONDS)
    });
    if (!response.ok) {
      return null;
    }
    return (await response.json()) as ShareWorldMetadataPayload;
  } catch {
    // Metadata is a bonus, never a blocker: an unreachable or cold API just
    // means the crawler sees the fallback copy.
    return null;
  }
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const payload = await fetchShareWorldForMetadata(params.shareSlug);
  const world = payload?.world;
  if (!world) {
    return { title: FALLBACK_PAGE_TITLE, description: FALLBACK_PAGE_DESCRIPTION };
  }

  const pageTitle = `${world.sceneName || "A personal universe"} — Myunivokai`;
  const portraitLine = world.nickname
    ? `A portrait of ${world.nickname}${world.archetype ? `, ${world.archetype}` : ""}.`
    : "";
  const pageDescription =
    [world.quote, world.shortNarrative, portraitLine].filter(Boolean).join(" ") || FALLBACK_PAGE_DESCRIPTION;

  return {
    title: pageTitle,
    description: pageDescription,
    openGraph: {
      title: pageTitle,
      description: pageDescription,
      siteName: "Myunivokai",
      type: "website"
    },
    twitter: {
      card: "summary",
      title: pageTitle,
      description: pageDescription
    }
  };
}

export default function ShareWorldPage({ params }: PageProps) {
  return <ShareWorldView shareSlug={params.shareSlug} />;
}
