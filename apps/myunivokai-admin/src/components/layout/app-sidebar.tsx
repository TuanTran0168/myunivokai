"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut } from "lucide-react";
import { motion } from "motion/react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { NAV_ITEMS } from "@/components/layout/nav-config";
import { BrandMark } from "@/components/layout/brand-mark";
import { hasPermission, type AccountSummary } from "@/lib/session";
import { useLogout } from "@/hooks/use-logout";
import { useSessionKeepAlive } from "@/hooks/use-session-keepalive";

function AccountAvatar({ email }: { email: string }) {
  const initial = email.charAt(0).toUpperCase();
  return (
    <div
      className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary"
      aria-hidden="true"
    >
      {initial}
    </div>
  );
}

export function AppSidebar({ account }: { account: AccountSummary | null }) {
  const pathname = usePathname();
  const visibleNavItems = NAV_ITEMS.filter((item) => hasPermission(account, item.permission));
  const logout = useLogout();
  const { isMobile, setOpenMobile } = useSidebar();
  useSessionKeepAlive();

  // On mobile the sidebar is a Sheet overlay (see ui/sidebar.tsx) sitting on
  // top of the page it navigates to — closing it here is standard behavior
  // for that pattern (every other Sheet-based nav closes itself on select).
  // Desktop's persistent column has no such overlay to dismiss, so it's a
  // no-op there.
  function handleNavigate() {
    if (isMobile) setOpenMobile(false);
  }

  return (
    <Sidebar>
      <SidebarHeader>
        <Link href="/" className="flex items-center gap-2 px-2 py-1.5">
          <BrandMark className="h-5 w-5 shrink-0" />
          <span className="font-heading text-base font-semibold text-sidebar-foreground">Myunivokai</span>
          <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-mono uppercase tracking-widest text-primary">
            Admin
          </span>
        </Link>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {visibleNavItems.map((item) => {
                const isActive = pathname === item.href;
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      isActive={isActive}
                      className="relative overflow-hidden data-[active=true]:bg-transparent"
                      render={
                        <Link href={item.href} onClick={handleNavigate}>
                          {isActive ? (
                            <motion.span
                              layoutId="nav-active-pill"
                              className="absolute inset-0 rounded-md bg-primary/15"
                              transition={{ type: "spring", stiffness: 420, damping: 34 }}
                            />
                          ) : null}
                          <item.icon className="relative z-10" />
                          <span className="relative z-10">{item.label}</span>
                        </Link>
                      }
                    />
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        {account ? (
          <div className="flex items-center gap-2 px-1 py-1">
            <AccountAvatar email={account.email} />
            <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">{account.email}</span>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => logout.mutate()}
              disabled={logout.isPending}
              aria-label="Log out"
            >
              <LogOut />
            </Button>
          </div>
        ) : null}
      </SidebarFooter>
    </Sidebar>
  );
}

