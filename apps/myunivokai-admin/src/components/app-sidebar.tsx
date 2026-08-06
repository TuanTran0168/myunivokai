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
  SidebarMenuItem
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { NAV_ITEMS } from "@/components/nav-config";
import { hasPermission, type AccountSummary } from "@/lib/session";
import { useLogout } from "@/hooks/use-logout";
import { useSessionKeepAlive } from "@/hooks/use-session-keepalive";

export function AppSidebar({ account }: { account: AccountSummary | null }) {
  const pathname = usePathname();
  const visibleNavItems = NAV_ITEMS.filter((item) => hasPermission(account, item.permission));
  const logout = useLogout();
  useSessionKeepAlive();

  return (
    <Sidebar>
      <SidebarHeader>
        <Link href="/" className="flex items-center gap-2 px-2 py-1.5 font-heading text-base font-semibold text-sidebar-foreground">
          Myunivokai
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
                        <Link href={item.href}>
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
          <div className="flex items-center justify-between gap-2 px-1 py-1">
            <span className="truncate font-mono text-xs text-muted-foreground">{account.email}</span>
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
