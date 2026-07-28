import type { Metadata } from "next";
import { ShareWorldView } from "@/features/share/ShareWorldView";
import { buildShareWorldMetadata } from "@/features/share/shareWorldMetadata";

// The universe share page. It lives under /universe so the two families are
// symmetric (/universe/... and /nature/...) — see lib/worldRoutes.ts. The
// historical un-prefixed /share/worlds/[shareSlug] was removed outright, so
// universe-service's PUBLIC_WEB_URL must carry the /universe prefix.

type PageProps = {
  params: {
    shareSlug: string;
  };
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  return buildShareWorldMetadata("universe", params.shareSlug);
}

export default function UniverseShareWorldPage({ params }: PageProps) {
  return <ShareWorldView shareSlug={params.shareSlug} family="universe" />;
}
