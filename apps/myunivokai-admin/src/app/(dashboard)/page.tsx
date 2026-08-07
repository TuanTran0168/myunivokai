import { cookies } from "next/headers";
import { LayoutDashboard } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { ADMIN_ACCOUNT_COOKIE_NAME, decodeAccountCookieValue } from "@/lib/session";

// Placeholder home screen. The real dashboard (totals per family, failure
// rate, publish rate, archetype/style distribution) is S4-ANALYTICS-007's
// job, once analytics-service exists to answer it from — see
// notes/sprints/sprint-04-2026-08-06/user-stories.md.
export default async function DashboardPage() {
  const cookieStore = await cookies();
  const accountCookie = cookieStore.get(ADMIN_ACCOUNT_COOKIE_NAME)?.value;
  const account = accountCookie ? decodeAccountCookieValue(accountCookie) : null;

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title={`Welcome${account ? `, ${account.email}` : ""}`}
      />
      {account ? (
        <Card className="card-interactive">
          <CardContent className="pt-2">
            <div className="flex items-center gap-3">
              <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/15">
                <LayoutDashboard className="size-4 text-primary" />
              </div>
              <div>
                <p className="text-sm font-medium">Roles</p>
                <p className="font-mono text-xs text-muted-foreground">{account.roles.join(", ") || "none"}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}
      <Card className="mt-4">
        <CardContent>
          <EmptyState
            icon={LayoutDashboard}
            title="Dashboard"
            description="Analytics and record screens land in S4-ANALYTICS-007, once analytics-service is serving queries."
          />
        </CardContent>
      </Card>
    </div>
  );
}

