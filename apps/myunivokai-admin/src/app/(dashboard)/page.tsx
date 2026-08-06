import { cookies } from "next/headers";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
      <Card className="glass-panel border-none">
        <CardHeader>
          <CardTitle className="font-heading text-xl">Welcome{account ? `, ${account.email}` : ""}</CardTitle>
          <CardDescription>
            Analytics and record screens land in S4-ANALYTICS-007, once analytics-service is serving queries.
          </CardDescription>
        </CardHeader>
        <CardContent className="font-mono text-xs text-muted-foreground">
          {account ? `Roles: ${account.roles.join(", ") || "none"}` : null}
        </CardContent>
      </Card>
    </div>
  );
}
