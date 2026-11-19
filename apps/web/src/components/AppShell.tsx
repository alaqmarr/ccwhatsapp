"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Link2, Loader2, LogOut, Menu, RefreshCw, X } from "lucide-react";
import type { AuthenticatedUser } from "@cc/auth";
import {
  AccountStatusBadge,
  ClassicConceptsWordmark,
  RoleBadge,
  SHORTLINK_PUBLIC_DOMAIN,
  WHATSAPP_PUBLIC_DOMAIN,
  WhatsAppLogoIcon,
} from "@cc/ui";
import { NotificationBell } from "@/components/NotificationBell";
import { buildNavSections } from "@/components/shell/navConfig";

interface BridgeHealthSummary {
  cc3003: boolean;
  ce3002: boolean;
  loaded: boolean;
}

let cachedBridgeHealth: { expiresAt: number; value: BridgeHealthSummary } | null = null;

function shouldAutoProbeBridge(pathname: string): boolean {
  return (
    pathname.startsWith("/dashboard/enquiries") ||
    pathname.startsWith("/dashboard/dev")
  );
}

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
  const [navigatingTo, setNavigatingTo] = useState<string | null>(null);
  const [checkingBridge, setCheckingBridge] = useState(false);
  const [bridgeSummary, setBridgeSummary] = useState<BridgeHealthSummary>(() =>
    cachedBridgeHealth && cachedBridgeHealth.expiresAt > Date.now()
      ? cachedBridgeHealth.value
      : { cc3003: false, ce3002: false, loaded: false }
  );

  useEffect(() => {
    setMobileNavOpen(false);
    setNavigatingTo(null);
  }, [pathname]);

  useEffect(() => {
    if (!navigatingTo) return;
    const safety = setTimeout(() => setNavigatingTo(null), 6000);
    return () => clearTimeout(safety);
  }, [navigatingTo]);

  const checkBridgeHealth = useCallback(async (force = false) => {
    if (!force && cachedBridgeHealth && cachedBridgeHealth.expiresAt > Date.now()) {
      setBridgeSummary(cachedBridgeHealth.value);
      return;
    }
    setCheckingBridge(true);
    try {
      const r = await fetch("/api/internal/website-enquiry", { cache: "no-store" });
      const d = await r.json().catch(() => null);
      if (!d?.ok || !d?.health) return;
      const next: BridgeHealthSummary = {
        cc3003: Boolean(
          d.health.classicConcepts3003?.online ||
            d.health.classicConcepts3003?.dbFallbackAvailable
        ),
        ce3002: Boolean(
          d.health.classicEdge3002?.online ||
            d.health.classicEdge3002?.dbFallbackAvailable
        ),
        loaded: true,
      };
      cachedBridgeHealth = { expiresAt: Date.now() + 30_000, value: next };
      setBridgeSummary(next);
    } catch {
      // Keep standby state cleanly when offline or unreachable.
    } finally {
      setCheckingBridge(false);
    }
  }, []);

  // Only probe local website bridges automatically on Enquiries / Dev pages.
  useEffect(() => {
    if (cachedBridgeHealth && cachedBridgeHealth.expiresAt > Date.now()) {
      setBridgeSummary(cachedBridgeHealth.value);
      return;
    }
    if (!shouldAutoProbeBridge(pathname)) return;
    void checkBridgeHealth(false);
  }, [pathname, checkBridgeHealth]);

  const isActiveAccount = user.status === "ACTIVE";
  const navSections = useMemo(
    () => buildNavSections(user, pendingApprovalsCount),
    [user, pendingApprovalsCount]
  );

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
                    onClick={() => {
                      setMobileNavOpen(false);
                      if (pathname !== item.href) {
                        setNavigatingTo(item.href);
                      }
                    }}
                    className={`flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg text-[12.5px] tracking-[-0.01em] transition-colors ${
                      active
                        ? "bg-[#00a884] text-white font-semibold shadow-2xs"
                        : "text-slate-700 font-medium hover:bg-slate-100/90 hover:text-slate-950"
                    }`}
                  >
                    <span className="flex items-center gap-2 truncate">
                      {navigatingTo === item.href && !active ? (
                        <Loader2 className="w-4 h-4 shrink-0 animate-spin text-[#00a884]" />
                      ) : (
                        <Icon className="w-4 h-4 shrink-0" />
                      )}
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
        <div className="px-2.5 py-1.5 rounded-lg bg-slate-50 border border-slate-200/80 flex items-center justify-between text-[10.5px] text-slate-600">
          <span className="font-medium">Ecosystem Sync</span>
          <span className="inline-flex items-center gap-1.5 font-mono">
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                !bridgeSummary.loaded
                  ? "bg-slate-300"
                  : bridgeSummary.cc3003
                  ? "bg-emerald-500"
                  : "bg-amber-400"
              }`}
              title={
                bridgeSummary.loaded
                  ? `Classic Concepts (:3003) ${bridgeSummary.cc3003 ? "online" : "offline"}`
                  : "Classic Concepts (:3003) standby"
              }
            />
            <span>CC</span>
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                !bridgeSummary.loaded
                  ? "bg-slate-300"
                  : bridgeSummary.ce3002
                  ? "bg-emerald-500"
                  : "bg-amber-400"
              }`}
              title={
                bridgeSummary.loaded
                  ? `Classic Edge 53 (:3002) ${bridgeSummary.ce3002 ? "online" : "offline"}`
                  : "Classic Edge 53 (:3002) standby"
              }
            />
            <span>CE53</span>
            <button
              type="button"
              onClick={() => void checkBridgeHealth(true)}
              disabled={checkingBridge}
              className="ml-0.5 p-0.5 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 cursor-pointer disabled:opacity-50"
              title="Check website bridge status"
              aria-label="Check website bridge status"
            >
              <RefreshCw className={`w-2.5 h-2.5 ${checkingBridge ? "animate-spin" : ""}`} />
            </button>
          </span>
        </div>
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
    <div className="h-dvh max-h-dvh overflow-hidden w-full flex flex-col lg:flex-row bg-neutral-50 text-slate-900 relative">
      {navigatingTo && (
        <div
          aria-hidden="true"
          className="fixed top-0 left-0 right-0 h-0.5 z-50 bg-[#00a884]/20 overflow-hidden pointer-events-none"
        >
          <div className="h-full w-1/2 bg-[#00a884] animate-pulse rounded-r-full" />
        </div>
      )}
      {/* Compact Sticky Mobile Top Bar (< lg) */}
      <header className="lg:hidden min-h-13 py-1.5 px-2.5 sm:px-3 bg-white border-b border-neutral-200 flex items-center justify-between gap-2 shrink-0 z-30">
        <div className="flex items-center gap-1.5 sm:gap-2 min-w-0 flex-1">
          <button
            type="button"
            onClick={() => setMobileNavOpen(true)}
            className="p-2 rounded-lg text-slate-700 hover:bg-slate-100 relative shrink-0"
            aria-label="Open navigation menu"
          >
            <Menu className="w-5 h-5" />
            {pendingApprovalsCount > 0 && (
              <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-amber-500" />
            )}
          </button>
          <div className="flex items-center gap-1.5 min-w-0 flex-1">
            <span className="w-5 h-5 rounded-full bg-[#25d366] text-white inline-flex items-center justify-center shrink-0">
              <WhatsAppLogoIcon size={12} />
            </span>
            <span className="font-display text-sm font-bold text-slate-900 truncate">
              {activeNavLabel}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
          {isActiveAccount &&
            user.role !== "CLIENT" &&
            pathname !== "/dashboard/inbox" && (
              <Link
                href="/dashboard/inbox"
                className="px-2 sm:px-2.5 py-1.5 rounded-lg bg-[#00a884] text-white text-xs font-semibold whitespace-nowrap"
              >
                Chats
              </Link>
            )}
          <span className="hidden xs:inline-flex sm:inline-flex">
            <RoleBadge role={user.role} />
          </span>
        </div>
      </header>

      {/* Mobile Slide-Over Navigation Drawer */}
      {mobileNavOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-slate-900/45 backdrop-blur-[1px]"
            onClick={() => setMobileNavOpen(false)}
          />
          <aside className="relative w-72 max-w-[86vw] h-full bg-white flex flex-col shadow-2xl z-10 overflow-hidden overscroll-contain">
            {renderSidebarContent()}
          </aside>
        </div>
      )}

      {/* Desktop Fixed Left Sidebar (lg+) */}
      <aside className="hidden lg:flex lg:w-60 lg:h-dvh lg:max-h-dvh lg:sticky lg:top-0 bg-white flex-col shrink-0 border-r border-neutral-200 overflow-hidden">
        {renderSidebarContent()}
      </aside>

      {/* Independent Scrollable Main Workspace */}
      <main className="flex-1 min-h-0 min-w-0 w-full overflow-y-auto overflow-x-hidden flex flex-col">
        {children}
      </main>
    </div>
  );
}
