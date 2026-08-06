import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// Placeholder: the worlds table (cursor-paginated, backed by analytics-service)
// is S4-ANALYTICS-007's job.
export default function WorldsPage() {
  return (
    <Card className="glass-panel border-none">
      <CardHeader>
        <CardTitle className="font-heading text-xl">Worlds</CardTitle>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">Coming in S4-ANALYTICS-007.</CardContent>
    </Card>
  );
}
