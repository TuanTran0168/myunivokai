import type { Metadata } from "next";
import { ShareWorldView } from "@/features/share/ShareWorldView";
import { buildShareWorldMetadata } from "@/features/share/shareWorldMetadata";

// The forest twin of /universe/share/worlds/[shareSlug]: same view component,
// nature backend. nature-service's PUBLIC_WEB_URL carries the /nature prefix,
// so the shareUrl it prints lands exactly here.

type PageProps = {
  params: {
    shareSlug: string;
  };
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  return buildShareWorldMetadata("nature", params.shareSlug);
}

export default function NatureShareWorldPage({ params }: PageProps) {
  return <ShareWorldView shareSlug={params.shareSlug} family="nature" />;
}
