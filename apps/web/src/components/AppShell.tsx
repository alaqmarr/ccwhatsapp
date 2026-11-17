"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  BarChart3,
  BookOpen,
  Contact2,
  LayoutDashboard,
  Truck,
  Users,
  Megaphone,
  FileText,
  Workflow,
  UserCheck,
  IndianRupee,
  HardDrive,
  FileCode,
  ShieldAlert,
  Cpu,
  Settings,
  LogOut,
  Menu,
  X,
  Link2,
  Mail,
  PhoneCall,
  Bot,
} from "lucide-react";
import type { AuthenticatedUser } from "@cc/auth";
import {
  canViewCostBreakdown,
  isDevRole,
  isSuperAdminCapable,
} from "@cc/rbac";
import {
  AccountStatusBadge,
  ClassicConceptsWordmark,
  RoleBadge,
  SHORTLINK_PUBLIC_DOMAIN,
  WHATSAPP_PUBLIC_DOMAIN,
  WhatsAppLogoIcon,
} from "@cc/ui";
import { NotificationBell } from "@/components/NotificationBell";

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
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [bridgeSummary, setBridgeSummary] = useState<{
    cc3003: boolean;
    ce3002: boolean;
    loaded: boolean;
  }>({ cc3003: false, ce3002: false, loaded: false });

  useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/internal/website-enquiry", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (cancelled || !d?.ok || !d?.health) return;
        setBridgeSummary({
          cc3003: Boolean(
            d.health.classicConcepts3003?.online ||
              d.health.classicConcepts3003?.dbFallbackAvailable
          ),
          ce3002: Boolean(
            d.health.classicEdge3002?.online ||
              d.health.classicEdge3002?.dbFallbackAvailable
          ),
          loaded: true,
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const isActiveAccount = user.status === "ACTIVE";
  const canSuperAdmin = isSuperAdminCapable(user.role) && isActiveAccount;
  const isDev = isDevRole(user.role) && isActiveAccount;
  const canViewPricing = isActiveAccount && canViewCostBreakdown(user.role);
  const canManageFlows =
    isActiveAccount &&
    ["DEV", "SUPERADMIN", "MANAGER", "ADMIN"].includes(user.role);

  const navSections: Array<{
    heading: string;
    items: Array<{
      href: string;
      label: string;
      icon: React.ComponentType<{ className?: string }>;
      visible: boolean;
      badge?: string;
    }>;
  }> = [
    {
      heading: "Workspace",
      items: [
        {
          href: "/dashboard",
          label: "Dashboard",
          icon: LayoutDashboard,
          visible: isActiveAccount && user.role !== "CLIENT",
        },
        {
          href: "/dashboard/inbox",
          label: "Customer Chats",
          icon: WhatsAppLogoIcon,
          visible: isActiveAccount && user.role !== "CLIENT",
        },
        {
          href: "/dashboard/enquiries",
          label: "Website Enquiries",
          icon: Mail,
          visible: isActiveAccount && user.role !== "CLIENT",
          badge: "CC+CE53",
        },
        {
          href: "/dashboard/call-queue",
          label: "Call & Lead Queue",
          icon: PhoneCall,
          visible: isActiveAccount && user.role !== "CLIENT",
          badge: "Queue",
        },
        {
          href: "/dashboard/contacts",
          label: "Contacts Database",
          icon: Contact2,
          visible: isActiveAccount && user.role !== "CLIENT",
        },
        {
          href: "/dashboard/teams",
          label: "Teams & Escalation",
          icon: Users,
          visible: isActiveAccount && user.role !== "CLIENT",
        },
        {
          href: "/dashboard/analytics",
          label: "Analytics & Reports",
          icon: BarChart3,
          visible: isActiveAccount,
        },
        {
          href: "/onboarding",
          label: "How to Use",
          icon: BookOpen,
          visible: true,
        },
      ],
    },
    {
      heading: "Campaigns & Flows",
      items: [
        {
          href: "/dashboard/tracking",
          label: "Order Tracking",
          icon: Truck,
          visible: isActiveAccount && user.role !== "CLIENT",
        },
        {
          href: "/dashboard/marketing",
          label: "Broadcasts & Short Links",
          icon: Megaphone,
          visible: isActiveAccount && user.role !== "CLIENT",
        },
        {
          href: "/dashboard/templates",
          label: "Templates & Button Flows",
          icon: FileText,
          visible: canManageFlows,
        },
        {
          href: "/dashboard/automations",
          label: "Auto-Replies Builder",
          icon: Workflow,
          visible: canManageFlows,
        },
        {
          href: "/dashboard/ai-training",
          label: "AI Training Studio",
          icon: Bot,
          visible: isActiveAccount && user.role !== "CLIENT",
          badge: "ACRIO",
        },
      ],
    },
    {
      heading: canViewPricing ? "Admin & Costs" : "Administration",
      items: [
        {
          href: "/dashboard/approvals",
          label: "Team Approvals",
          icon: UserCheck,
          visible: canSuperAdmin,
          badge:
            pendingApprovalsCount > 0
              ? String(pendingApprovalsCount)
              : undefined,
        },
        {
          href: "/dashboard/pricing",
          label: "Cost Breakdown",
          icon: IndianRupee,
          visible: canViewPricing,
        },
        {
          href: "/dashboard/dev",
          label: "Dev Profit & Ops",
          icon: HardDrive,
          visible: isDev,
        },
        {
          href: "/dashboard/claude-usage",
          label: "Claude Usage & Spend",
          icon: Cpu,
          visible: isDev,
          badge: "USD",
        },
        {
          href: "/dashboard/issues-identifier",
          label: "Issues Identifier",
          icon: ShieldAlert,
          visible: isDev,
          badge: "ACRIO",
        },
        {
          href: "/dashboard/ai-logs",
          label: "AI Logs (ai.logs)",
          icon: FileCode,
          visible: isDev,
        },
        {
          href: "/setup",
          label: "Facebook Setup",
          icon: Settings,
          visible: isDev,
        },
      ],
    },
  ];

  const isNavActive = (href: string) =>
    href === "/dashboard"
      ? pathname === "/dashboard"
      : pathname === href || (href !== "/onboarding" && pathname.startsWith(href));

  const activeNavLabel =
    navSections
      .flatMap((s) => s.items)
      .find((i) => isNavActive(i.href))?.label || "Workspace";

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  const renderSidebarContent = () => (
    <>
      <div className="px-3.5 py-2.5 border-b border-neutral-200 space-y-1.5 shrink-0">
        <div className="flex items-center justify-between gap-2">
          <ClassicConceptsWordmark height={34} variant="light" />
          <button
            type="button"
            onClick={() => setMobileNavOpen(false)}
            className="lg:hidden p-1.5 rounded-lg text-slate-500 hover:bg-slate-100"
            aria-label="Close menu"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="w-4 h-4 rounded-full bg-[#25d366] text-white inline-flex items-center justify-center shrink-0 shadow-2xs">
            <WhatsAppLogoIcon size={10} />
          </span>
          <span className="font-mono text-[10.5px] font-medium text-slate-500 tracking-tight truncate">
            {WHATSAPP_PUBLIC_DOMAIN}
          </span>
          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-emerald-50 border border-emerald-200 font-mono text-[10px] font-semibold text-emerald-800">
            <Link2 className="w-2.5 h-2.5" />
            {SHORTLINK_PUBLIC_DOMAIN}
          </span>
        </div>
      </div>

      <div className="px-3.5 py-2 border-b border-neutral-200 bg-slate-50/75 space-y-1 shrink-0">
        <div className="flex items-start justify-between gap-2">
          <Link
            href="/dashboard/profile"
            onClick={() => setMobileNavOpen(false)}
            className="min-w-0 block group"
            title="Edit my profile and email"
          >
            <div className="font-display text-[13px] font-bold tracking-tight text-slate-900 truncate group-hover:text-[#008069]">
              {user.name}
            </div>
            <div className="text-[11px] text-slate-500 truncate">{user.email}</div>
          </Link>
          {isActiveAccount && user.role !== "CLIENT" && <NotificationBell userId={user.id} />}
        </div>
        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
          <RoleBadge role={user.role} />
          <AccountStatusBadge status={user.status} />
        </div>
      </div>

      <nav className="flex-1 min-h-0 overflow-y-auto px-2.5 py-2 space-y-2.5">
        {navSections.map((section) => {
          const visibleItems = section.items.filter((item) => item.visible);
          if (visibleItems.length === 0) return null;
          return (
            <div key={section.heading} className="space-y-0.5">
              <div className="px-2.5 pb-0.5 text-[10px] font-bold uppercase tracking-[0.08em] text-slate-400 select-none">
                {section.heading}
              </div>
              {visibleItems.map((item) => {
                const Icon = item.icon;
                const active = isNavActive(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMobileNavOpen(false)}
                    className={`flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg text-[12.5px] tracking-[-0.01em] transition-colors ${
                      active
                        ? "bg-[#00a884] text-white font-semibold shadow-2xs"
                        : "text-slate-700 font-medium hover:bg-slate-100/90 hover:text-slate-950"
                    }`}
                  >
                    <span className="flex items-center gap-2 truncate">
                      <Icon className="w-4 h-4 shrink-0" />
                      <span className="truncate">{item.label}</span>
                    </span>
                    {item.badge && (
                      <span
                        className={`px-1.5 py-0.5 rounded-md text-[9.5px] font-bold uppercase tracking-[0.05em] tabular-nums ${
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
            </div>
          );
        })}
      </nav>

      <div className="p-2.5 border-t border-neutral-200 shrink-0 bg-white space-y-1.5">
        {bridgeSummary.loaded && (
          <div className="px-2.5 py-1.5 rounded-lg bg-slate-50 border border-slate-200/80 flex items-center justify-between text-[10.5px] text-slate-600">
            <span className="font-medium">Ecosystem Sync</span>
            <span className="inline-flex items-center gap-1.5 font-mono">
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  bridgeSummary.cc3003 ? "bg-emerald-500" : "bg-amber-400"
                }`}
                title="Classic Concepts (:3003)"
              />
              <span>CC</span>
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  bridgeSummary.ce3002 ? "bg-emerald-500" : "bg-amber-400"
                }`}
                title="Classic Edge 53 (:3002)"
              />
              <span>CE53</span>
            </span>
          </div>
        )}
        <button
          type="button"
          onClick={handleLogout}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-white hover:bg-slate-50 text-slate-700 hover:text-slate-900 text-xs font-semibold border border-neutral-200 cursor-pointer transition-colors"
        >
          <LogOut className="w-3.5 h-3.5" />
          <span>Sign out</span>
        </button>
      </div>
    </>
  );

  return (
    <div className="h-dvh max-h-dvh overflow-hidden w-full flex flex-col lg:flex-row bg-neutral-50 text-slate-900">
      {/* Compact Sticky Mobile Top Bar (< lg) */}
      <header className="lg:hidden h-13 px-3 bg-white border-b border-neutral-200 flex items-center justify-between gap-2 shrink-0 z-30">
        <div className="flex items-center gap-2 min-w-0">
          <button
            type="button"
            onClick={() => setMobileNavOpen(true)}
            className="p-2 rounded-lg text-slate-700 hover:bg-slate-100 relative"
            aria-label="Open navigation menu"
          >
            <Menu className="w-5 h-5" />
            {pendingApprovalsCount > 0 && (
              <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-amber-500" />
            )}
          </button>
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="w-5 h-5 rounded-full bg-[#25d366] text-white inline-flex items-center justify-center shrink-0">
              <WhatsAppLogoIcon size={12} />
            </span>
            <span className="font-display text-sm font-bold text-slate-900 truncate">
              {activeNavLabel}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {isActiveAccount &&
            user.role !== "CLIENT" &&
            pathname !== "/dashboard/inbox" && (
              <Link
                href="/dashboard/inbox"
                className="px-2.5 py-1.5 rounded-lg bg-[#00a884] text-white text-xs font-semibold"
              >
                Chats
              </Link>
            )}
          <RoleBadge role={user.role} />
        </div>
      </header>

      {/* Mobile Slide-Over Navigation Drawer */}
      {mobileNavOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-slate-900/45 backdrop-blur-[1px]"
            onClick={() => setMobileNavOpen(false)}
          />
          <aside className="relative w-72 max-w-[84vw] h-full bg-white flex flex-col shadow-2xl z-10 overflow-hidden">
            {renderSidebarContent()}
          </aside>
        </div>
      )}

      {/* Desktop Fixed Left Sidebar (lg+) */}
      <aside className="hidden lg:flex lg:w-60 lg:h-dvh lg:max-h-dvh lg:sticky lg:top-0 bg-white flex-col shrink-0 border-r border-neutral-200 overflow-hidden">
        {renderSidebarContent()}
      </aside>

      {/* Independent Scrollable Main Workspace */}
      <main className="flex-1 min-h-0 min-w-0 w-full overflow-y-auto flex flex-col">
        {children}
      </main>
    </div>
  );
}
