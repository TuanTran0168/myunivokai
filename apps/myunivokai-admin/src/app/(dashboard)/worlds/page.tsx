import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/layout/page-header";

// Placeholder: the worlds table (cursor-paginated, backed by analytics-service)
// is S4-ANALYTICS-007's job.
export default function WorldsPage() {
  return (
    <div>
      <PageHeader title="Worlds" />
      <Card>
        <CardContent className="py-6 text-center text-sm text-muted-foreground">Coming in S4-ANALYTICS-007.</CardContent>
      </Card>
    </div>
  );
}
