"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { useTotalUnread } from "@/hooks/use-total-unread";
import { useUnreadNotifications } from "@/hooks/use-unread-notifications";
import { OrganiZAPLogo } from "@/components/brand/organizap-logo";
import {
  Bell,
  Bot,
  CalendarDays,
  Kanban,
  LayoutDashboard,
  MessageSquare,
  Radio,
  Settings,
  Users,
  X,
  Zap,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar";

interface NavItem {
  href: string;
  labelKey: string;
  icon: typeof LayoutDashboard;
}

const navItems: NavItem[] = [
  { href: "/dashboard", labelKey: "dashboard", icon: LayoutDashboard },
  { href: "/pipelines", labelKey: "pipelines", icon: Kanban },
  { href: "/inbox", labelKey: "inbox", icon: MessageSquare },
  { href: "/contacts", labelKey: "contacts", icon: Users },
  { href: "/tasks", labelKey: "tasks", icon: CalendarDays },
  { href: "/broadcasts", labelKey: "broadcasts", icon: Radio },
  { href: "/automations", labelKey: "automations", icon: Zap },
  { href: "/notifications", labelKey: "notifications", icon: Bell },
  { href: "/agents", labelKey: "aiAgents", icon: Bot },
];

const bottomNavItems = [
  { href: "/settings", labelKey: "settings", icon: Settings },
];

interface SidebarProps {
  /** Controlled on mobile by the Header's hamburger button. Ignored on lg+. */
  open?: boolean;
  onClose?: () => void;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
}

import { useTranslations } from "next-intl";

export function Sidebar({ open = false, onClose, collapsed = false, onToggleCollapsed }: SidebarProps) {
  const t = useTranslations("Sidebar");
  const pathname = usePathname();
  const { account } = useAuth();
  const totalUnread = useTotalUnread();
  const unreadNotifications = useUnreadNotifications();
  // Close the drawer when route changes — users opened it to navigate,
  // so once they pick a destination the drawer should get out of the way.
  useEffect(() => {
    onClose?.();
    // Only pathname drives this — onClose identity doesn't need to re-run it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // Lock body scroll and allow Escape to close while the drawer is open on
  // mobile. No-ops on desktop because the sidebar isn't positioned there.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  return (
    <>
      {/* Backdrop — only exists on mobile and only when open. Clicking
          it closes the drawer. Hidden from lg+ since the sidebar is
          part of the main flex row there. */}
      <button
        type="button"
        aria-label={t("closeMenu")}
        onClick={onClose}
        className={cn(
          "fixed inset-0 z-30 bg-background/70 backdrop-blur-sm transition-opacity lg:hidden",
          open
            ? "pointer-events-auto opacity-100"
            : "pointer-events-none opacity-0",
        )}
      />

      <aside
        className={cn(
          // Mobile: fixed drawer that slides in from the left.
          "fixed inset-y-0 left-0 z-40 flex h-full w-64 flex-col border-r border-border bg-card",
          "transition-transform duration-200 ease-out will-change-transform",
          open ? "translate-x-0" : "-translate-x-full",
          // Desktop: static, always visible — reset all the mobile framing.
          collapsed ? "lg:static lg:z-0 lg:w-16 lg:translate-x-0 lg:transition-[width]" : "lg:static lg:z-0 lg:w-60 lg:translate-x-0 lg:transition-[width]",
        )}
        aria-label="Principal"
      >
        {/* The active CRM account is the sidebar's primary identity.
            OrganiZAP remains subtly present in the user footer below. */}
        <div className={cn("flex h-14 shrink-0 items-center justify-between gap-2 border-b border-border", collapsed ? "px-3" : "px-4")}>
          <Link
            href="/settings?tab=company"
            className="flex min-w-0 items-center gap-2"
            title={collapsed ? account?.name ?? "OrganiZAP" : undefined}
          >
            {account?.logo_url ? (
              <Avatar className="size-7 shrink-0 rounded-md">
                <AvatarImage src={account.logo_url} alt="" />
                <AvatarFallback className="rounded-md bg-primary/10 text-xs font-semibold text-primary">
                  {account.name?.charAt(0).toUpperCase() ?? "C"}
                </AvatarFallback>
              </Avatar>
            ) : account ? (
              <Avatar className="size-7 shrink-0 rounded-md">
                <AvatarFallback className="rounded-md bg-primary/10 text-xs font-semibold text-primary">
                  {account.name?.charAt(0).toUpperCase() ?? "C"}
                </AvatarFallback>
              </Avatar>
            ) : (
              <OrganiZAPLogo size="sm" compact priority />
            )}
            <span className={cn("truncate text-sm font-semibold text-foreground", collapsed && "lg:hidden")}>
              {account?.name ?? "OrganiZAP"}
            </span>
          </Link>
          <button
            type="button"
            onClick={onToggleCollapsed}
            aria-label={collapsed ? "Expandir menu" : "Recolher menu"}
            title={collapsed ? "Expandir menu" : "Recolher menu"}
            className="hidden size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground lg:flex"
          >
            {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("closeMenu")}
            className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground lg:hidden"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Main navigation */}
        <nav className={cn("flex-1 overflow-y-auto py-4", collapsed ? "px-2" : "px-3")}>
          <ul className="flex flex-col gap-1">
            {navItems.map((item) => {
              const isActive =
                pathname === item.href ||
                (item.href !== "/dashboard" && pathname.startsWith(item.href));

              const showUnreadDot =
                item.href === "/inbox" && totalUnread > 0 && !isActive;

              // Unlike the inbox dot, the notifications count stays visible
              // even while the page is active — it reflects unread state
              // (cleared by marking notifications read), not "currently
              // viewing this section".
              const showNotificationBadge =
                item.href === "/notifications" && unreadNotifications > 0;

              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className={cn(
                      // Taller on mobile so fingers can hit the row reliably (≥44px).
                      "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors lg:py-2",
                      isActive
                        ? "bg-primary/10 text-primary"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground",
                    )}
                  >
                    <item.icon className="h-4 w-4 shrink-0" />
                    <span className={cn("flex-1", collapsed && "lg:hidden")}>{t(item.labelKey as string)}</span>
                    {showUnreadDot && (
                      <span
                        aria-label={t("unreadConversations", { count: totalUnread })}
                        className="relative flex h-2 w-2"
                      >
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
                        <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
                      </span>
                    )}
                    {showNotificationBadge && (
                      <span
                        aria-label={t("unreadNotifications", { count: unreadNotifications })}
                        className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground"
                      >
                        {unreadNotifications > 9 ? "9+" : unreadNotifications}
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>

          <div className="my-4 border-t border-border" />

          <ul className="flex flex-col gap-1">
            {bottomNavItems.map((item) => {
              const isActive = pathname.startsWith(item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className={cn(
                      "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors lg:py-2",
                      isActive
                        ? "bg-primary/10 text-primary"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground",
                    )}
                  >
                    <item.icon className="h-4 w-4 shrink-0" />
                    <span className={cn(collapsed && "lg:hidden")}>{t(item.labelKey as string)}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* Product signature. Profile and account switching stay in the
            header menu, keeping this footer deliberately brand-only. */}
        <div className={cn("shrink-0 border-t border-border p-3", collapsed && "lg:px-2")}>
          <Link
            href="/dashboard"
            className={cn("mb-2 flex items-center gap-2 px-2 text-muted-foreground", collapsed && "lg:justify-center lg:px-0")}
            title={collapsed ? "OrganiZAP" : undefined}
          >
            <OrganiZAPLogo size="sm" compact={collapsed} />
          </Link>
        </div>
      </aside>
    </>
  );
}
