import { Globe2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/ui/empty-state";

// Placeholder: the worlds table (cursor-paginated, backed by analytics-service)
// is S4-ANALYTICS-007's job.
export default function WorldsPage() {
  return (
    <div>
      <PageHeader title="Worlds" />
      <Card>
        <CardContent>
          <EmptyState icon={Globe2} title="Worlds" description="Coming in S4-ANALYTICS-007." />
        </CardContent>
      </Card>
    </div>
  );
}

