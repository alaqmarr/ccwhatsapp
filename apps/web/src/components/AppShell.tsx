"use client";

import React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  BookOpen,
  MessageSquare,
  Megaphone,
  Workflow,
  UserCheck,
  IndianRupee,
  HardDrive,
  Settings,
  LogOut,
} from "lucide-react";
import type { AuthenticatedUser } from "@cc/auth";
import { isDevRole, isSuperAdminCapable } from "@cc/rbac";
import {
  AccountStatusBadge,
  RoleBadge,
  WHATSAPP_PUBLIC_DOMAIN,
  WhatsAppLogoIcon,
} from "@cc/ui";

export function AppShell({
  user,
  pendingApprovalsCount = 0,
  children,
}: {
  user: AuthenticatedUser;
  pendingApprovalsCount?: number;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();

  const isActiveAccount = user.status === "ACTIVE";
  const canSuperAdmin = isSuperAdminCapable(user.role) && isActiveAccount;
  const isDev = isDevRole(user.role) && isActiveAccount;
  const canViewPricing =
    isActiveAccount &&
    ["DEV", "SUPERADMIN", "ADMIN", "CLIENT"].includes(user.role);

  const navItems = [
    {
      href: "/onboarding",
      label: "How to Use",
      icon: BookOpen,
      visible: true,
      badge: !user.onboardingCompletedAt ? "New" : undefined,
    },
    {
      href: "/dashboard/inbox",
      label: "Customer Chats",
      icon: MessageSquare,
      visible: isActiveAccount && user.role !== "CLIENT",
    },
    {
      href: "/dashboard/marketing",
      label: "Broadcasts & Short Links",
      icon: Megaphone,
      visible: isActiveAccount && user.role !== "CLIENT",
    },
    {
      href: "/dashboard/automations",
      label: "Auto-Replies",
      icon: Workflow,
      visible: isActiveAccount && user.role !== "CLIENT",
    },
    {
      href: "/dashboard/approvals",
      label: "Team Approvals",
      icon: UserCheck,
      visible: canSuperAdmin,
      badge:
        pendingApprovalsCount > 0 ? String(pendingApprovalsCount) : undefined,
    },
    {
      href: "/dashboard/pricing",
      label: isDev ? "Meta Cost & Margin" : "Message Charges",
      icon: IndianRupee,
      visible: canViewPricing,
    },
    {
      href: "/dashboard/dev",
      label: "Daily Backups",
      icon: HardDrive,
      visible: isDev,
    },
    {
      href: "/setup",
      label: "Facebook Setup",
      icon: Settings,
      visible: isDev,
    },
  ];

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="min-h-screen w-full flex flex-col lg:flex-row bg-neutral-50 text-neutral-900">
      {/* Light-Mode Left Navigation */}
      <aside className="w-full lg:w-60 bg-white flex flex-col justify-between shrink-0 border-b lg:border-b-0 lg:border-r border-neutral-200">
        <div>
          <div className="px-4 py-3.5 border-b border-neutral-200 flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-md bg-[#1da851] flex items-center justify-center text-white shrink-0">
              <WhatsAppLogoIcon size={18} />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-neutral-900 truncate">
                Classic Concepts
              </div>
              <p className="text-xs text-neutral-500 truncate">
                {WHATSAPP_PUBLIC_DOMAIN}
              </p>
            </div>
          </div>

          <div className="px-4 py-3 border-b border-neutral-200 bg-neutral-50/70 space-y-1.5">
            <div className="text-sm font-medium text-neutral-900 truncate">
              {user.name}
            </div>
            <div className="text-xs text-neutral-500 truncate">{user.email}</div>
            <div className="text-xs text-neutral-500 truncate">
              {user.whatsappNumber}
            </div>
            <div className="flex flex-wrap items-center gap-1.5 pt-1">
              <RoleBadge role={user.role} />
              <AccountStatusBadge status={user.status} />
            </div>
          </div>

          <nav className="p-2.5 space-y-0.5">
            {navItems
              .filter((item) => item.visible)
              .map((item) => {
                const Icon = item.icon;
                const active =
                  pathname === item.href ||
                  (item.href !== "/onboarding" && pathname.startsWith(item.href));
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`flex items-center justify-between gap-2 px-3 py-2 rounded-md text-sm transition-colors ${
                      active
                        ? "bg-neutral-900 text-white font-medium"
                        : "text-neutral-700 hover:bg-neutral-100 hover:text-neutral-900"
                    }`}
                  >
                    <span className="flex items-center gap-2.5">
                      <Icon className="w-4 h-4 shrink-0" />
                      <span>{item.label}</span>
                    </span>
                    {item.badge && (
                      <span
                        className={`px-1.5 py-0.5 rounded text-[11px] font-medium ${
                          active
                            ? "bg-white/20 text-white"
                            : "bg-amber-100 text-amber-900"
                        }`}
                      >
                        {item.badge}
                      </span>
                    )}
                  </Link>
                );
              })}
          </nav>
        </div>

        <div className="p-3 border-t border-neutral-200">
          <button
            type="button"
            onClick={handleLogout}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-md bg-white hover:bg-neutral-100 text-neutral-700 text-xs font-medium border border-neutral-200 cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Sign out</span>
          </button>
        </div>
      </aside>

      {/* Full-Width Main Workspace */}
      <main className="flex-1 min-w-0 w-full flex flex-col">{children}</main>
    </div>
  );
}
