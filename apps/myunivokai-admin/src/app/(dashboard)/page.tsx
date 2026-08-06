import { cookies } from "next/headers";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/layout/page-header";
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
        description="Analytics and record screens land in S4-ANALYTICS-007, once analytics-service is serving queries."
      />
      {account ? (
        <Card>
          <CardContent className="pt-2 font-mono text-xs text-muted-foreground">
            Roles: {account.roles.join(", ") || "none"}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
