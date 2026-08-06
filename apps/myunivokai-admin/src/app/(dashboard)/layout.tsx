import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { ADMIN_ACCOUNT_COOKIE_NAME, decodeAccountCookieValue } from "@/lib/session";

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const cookieStore = await cookies();
  const accountCookie = cookieStore.get(ADMIN_ACCOUNT_COOKIE_NAME)?.value;
  // A missing/undecodable account cookie here means middleware let the
  // request through on a fresh access token whose account cache has not
  // been populated yet (e.g. immediately post-login, before this app ever
  // called refresh) — the nav simply renders with nothing visible rather
  // than this layout re-deciding auth, which is middleware's job alone.
  const account = accountCookie ? decodeAccountCookieValue(accountCookie) : null;

  return (
    <SidebarProvider>
      <AppSidebar account={account} />
      <SidebarInset>
        <header className="glass-panel sticky top-0 z-10 flex h-14 items-center gap-3 border-b border-border/60 px-4">
          <SidebarTrigger />
        </header>
        <main className="flex-1 p-6">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
