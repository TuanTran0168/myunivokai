import { permanentRedirect } from "next/navigation";
import { sharePagePath } from "@/lib/worldRoutes";

// LEGACY ROUTE — do not delete.
//
// Universe share links used to live here, un-prefixed, while forest links lived
// under /nature. The two families are now symmetric (/universe and /nature), but
// every universe link ever handed out — and every shareUrl already persisted in
// the universe database — still points at this path. So it stays forever as a
// 308 to the canonical location, which also passes any search ranking along.
//
// Nothing should link here on purpose: sharePagePath() emits /universe/... .

type PageProps = {
  params: {
    shareSlug: string;
  };
};

export default function LegacyShareWorldPage({ params }: PageProps) {
  permanentRedirect(sharePagePath(params.shareSlug, "universe"));
}
