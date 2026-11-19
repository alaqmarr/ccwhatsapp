"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  ChevronDown,
  ChevronRight,
  ChevronsLeft,
  Link2,
  Loader2,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  X,
} from "lucide-react";
import type { AuthenticatedUser } from "@cc/auth";
import {
  AccountStatusBadge,
  ClassicConceptsMark,
  ClassicConceptsWordmark,
  RoleBadge,
  SHORTLINK_PUBLIC_DOMAIN,
  WHATSAPP_PUBLIC_DOMAIN,
  WhatsAppLogoIcon,
} from "@cc/ui";
import { NotificationBell } from "@/components/NotificationBell";
import {
  buildNavSections,
  buildPinnedInboxNavItem,
} from "@/components/shell/navConfig";

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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarHidden, setSidebarHidden] = useState(false);
  const [collapsedSections, setCollapsedSections] = useState<
    Record<string, boolean>
  >({
    campaigns: true,
    admin: true,
  });
  const [navigatingTo, setNavigatingTo] = useState<string | null>(null);
  const [checkingBridge, setCheckingBridge] = useState(false);

  useEffect(() => {
    try {
      const savedRail = window.localStorage.getItem("cc_sidebar_rail");
      if (savedRail === "1") setSidebarCollapsed(true);
      const savedHidden = window.localStorage.getItem("cc_sidebar_hidden");
      if (savedHidden === "1") setSidebarHidden(true);
      const savedSec = window.localStorage.getItem(
        "cc_sidebar_collapsed_sections"
      );
      if (savedSec) {
        const parsed = JSON.parse(savedSec) as Record<string, boolean>;
        if (parsed && typeof parsed === "object") {
          setCollapsedSections(parsed);
        }
      }
    } catch {
      // ignore storage access errors
    }
  }, []);

  const toggleSidebarRail = () => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem("cc_sidebar_rail", next ? "1" : "0");
      } catch {
        // ignore storage errors
      }
      return next;
    });
  };

  const toggleSidebarHidden = () => {
    setSidebarHidden((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem("cc_sidebar_hidden", next ? "1" : "0");
      } catch {
        // ignore storage errors
      }
      return next;
    });
  };

  const toggleSection = (sectionId: string) => {
    setCollapsedSections((prev) => {
      const next = { ...prev, [sectionId]: !prev[sectionId] };
      try {
        window.localStorage.setItem(
          "cc_sidebar_collapsed_sections",
          JSON.stringify(next)
        );
      } catch {
        // ignore storage errors
      }
      return next;
    });
  };
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
  const pinnedInbox = useMemo(() => buildPinnedInboxNavItem(user), [user]);
  const navSections = useMemo(
    () => buildNavSections(user, pendingApprovalsCount),
    [user, pendingApprovalsCount]
  );

  const isNavActive = (href: string) =>
    href === "/dashboard"
      ? pathname === "/dashboard"
      : pathname === href || (href !== "/onboarding" && pathname.startsWith(href));

  const activeNavLabel =
    (pinnedInbox.visible && isNavActive(pinnedInbox.href)
      ? pinnedInbox.label
      : navSections
          .flatMap((s) => s.items)
          .find((i) => isNavActive(i.href))?.label) || "Workspace";

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  const renderSidebarContent = (compactRail: boolean) => {
    const PinnedIcon = pinnedInbox.icon;
    const pinnedActive = isNavActive(pinnedInbox.href);

    return (
      <>
        <div
          className={`${
            compactRail ? "px-2 py-2.5" : "px-3.5 py-2.5"
          } border-b border-neutral-200 space-y-1.5 shrink-0`}
        >
          <div
            className={`flex ${
              compactRail
                ? "flex-col items-center gap-1.5"
                : "items-center justify-between gap-2"
            }`}
          >
            {compactRail ? (
              <div className="mx-auto">
                <ClassicConceptsMark size={26} />
              </div>
            ) : (
              <ClassicConceptsWordmark height={34} variant="light" />
            )}
            <div className="flex items-center gap-0.5 shrink-0">
              <button
                type="button"
                onClick={toggleSidebarRail}
                title={
                  compactRail
                    ? "Expand sidebar"
                    : "Shrink to icons"
                }
                aria-label={compactRail ? "Expand sidebar" : "Shrink sidebar"}
                className="hidden lg:inline-flex p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900 cursor-pointer shrink-0"
              >
                {compactRail ? (
                  <PanelLeftOpen className="w-4 h-4" />
                ) : (
                  <PanelLeftClose className="w-4 h-4" />
                )}
              </button>
              <button
                type="button"
                onClick={toggleSidebarHidden}
                title="Hide left navigation window"
                aria-label="Hide navigation sidebar"
                className="hidden lg:inline-flex p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900 cursor-pointer shrink-0"
              >
                <ChevronsLeft className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => setMobileNavOpen(false)}
                className="lg:hidden p-1.5 rounded-lg text-slate-500 hover:bg-slate-100"
                aria-label="Close menu"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>
          {!compactRail && (
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
          )}
        </div>

        <div
          className={`${
            compactRail ? "px-2 py-2 flex justify-center" : "px-3.5 py-2 space-y-1"
          } border-b border-neutral-200 bg-slate-50/75 shrink-0`}
        >
          {compactRail ? (
            isActiveAccount &&
            user.role !== "CLIENT" && (
              <NotificationBell userId={user.id} userName={user.name} />
            )
          ) : (
            <>
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
                  <div className="text-[11px] text-slate-500 truncate">
                    {user.email}
                  </div>
                </Link>
                {isActiveAccount && user.role !== "CLIENT" && (
                  <NotificationBell userId={user.id} userName={user.name} />
                )}
              </div>
              <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                <RoleBadge role={user.role} />
                <AccountStatusBadge status={user.status} />
              </div>
            </>
          )}
        </div>

        {pinnedInbox.visible && (
          <div
            className={`${
              compactRail ? "px-2 pt-2.5 pb-1.5" : "px-2.5 pt-2.5 pb-2"
            } border-b border-neutral-200 bg-white shrink-0`}
          >
            <Link
              href={pinnedInbox.href}
              title={pinnedInbox.label}
              onClick={() => {
                setMobileNavOpen(false);
                if (pathname !== pinnedInbox.href) {
                  setNavigatingTo(pinnedInbox.href);
                }
              }}
              className={`flex items-center ${
                compactRail ? "justify-center px-2 py-2" : "justify-between px-3 py-2"
              } rounded-lg text-[13px] font-semibold transition-colors ${
                pinnedActive
                  ? "bg-[#00a884] text-white shadow-2xs"
                  : "bg-[#e7fce3]/70 border border-emerald-200 text-[#008069] hover:bg-[#d8f8d2]"
              }`}
            >
              <span className="flex items-center gap-2 min-w-0">
                {navigatingTo === pinnedInbox.href && !pinnedActive ? (
                  <Loader2 className="w-4 h-4 shrink-0 animate-spin" />
                ) : (
                  <PinnedIcon className="w-4 h-4 shrink-0" />
                )}
                {!compactRail && (
                  <span className="truncate">{pinnedInbox.label}</span>
                )}
              </span>
              {!compactRail && (
                <span
                  className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${
                    pinnedActive
                      ? "bg-white/20 text-white"
                      : "bg-white text-[#008069]"
                  }`}
                >
                  Inbox
                </span>
              )}
            </Link>
          </div>
        )}

        <nav className="flex-1 min-h-0 overflow-y-auto px-2 py-2 space-y-2">
          {navSections.map((section) => {
            const visibleItems = section.items.filter((item) => item.visible);
            if (visibleItems.length === 0) return null;
            const hasActiveInSection = visibleItems.some((i) =>
              isNavActive(i.href)
            );
            const isCollapsed =
              !compactRail &&
              !hasActiveInSection &&
              Boolean(collapsedSections[section.id]);

            return (
              <div
                key={section.id}
                className={compactRail ? "pt-1 border-t border-neutral-100 first:border-t-0 space-y-1" : "space-y-0.5"}
              >
                {!compactRail && (
                  <button
                    type="button"
                    onClick={() => toggleSection(section.id)}
                    aria-expanded={!isCollapsed}
                    className="w-full flex items-center justify-between px-2.5 py-1 rounded-md text-[10.5px] font-bold uppercase tracking-[0.07em] text-slate-500 hover:text-slate-800 hover:bg-slate-100/70 cursor-pointer select-none"
                  >
                    <span>{section.heading}</span>
                    {isCollapsed ? (
                      <ChevronRight className="w-3.5 h-3.5" />
                    ) : (
                      <ChevronDown className="w-3.5 h-3.5" />
                    )}
                  </button>
                )}

                {!isCollapsed &&
                  visibleItems.map((item) => {
                    const Icon = item.icon;
                    const active = isNavActive(item.href);
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        title={compactRail ? item.label : undefined}
                        onClick={() => {
                          setMobileNavOpen(false);
                          if (pathname !== item.href) {
                            setNavigatingTo(item.href);
                          }
                        }}
                        className={`flex items-center ${
                          compactRail
                            ? "justify-center px-2 py-2"
                            : "justify-between gap-2 px-2.5 py-1.5"
                        } rounded-lg text-[12.5px] tracking-[-0.01em] transition-colors ${
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
                          {!compactRail && (
                            <span className="truncate">{item.label}</span>
                          )}
                        </span>
                        {!compactRail && item.badge && (
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

        <div
          className={`${
            compactRail ? "p-2" : "p-2.5"
          } border-t border-neutral-200 shrink-0 bg-white space-y-1.5`}
        >
          {!compactRail && (
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
                      ? `Classic Concepts (:3003) ${
                          bridgeSummary.cc3003 ? "online" : "offline"
                        }`
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
                      ? `Classic Edge 53 (:3002) ${
                          bridgeSummary.ce3002 ? "online" : "offline"
                        }`
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
                  <RefreshCw
                    className={`w-2.5 h-2.5 ${
                      checkingBridge ? "animate-spin" : ""
                    }`}
                  />
                </button>
              </span>
            </div>
          )}
          <button
            type="button"
            onClick={handleLogout}
            title="Sign out"
            className={`w-full flex items-center justify-center gap-2 ${
              compactRail ? "px-2 py-2" : "px-3 py-2"
            } rounded-lg bg-white hover:bg-slate-50 text-slate-700 hover:text-slate-900 text-xs font-semibold border border-neutral-200 cursor-pointer transition-colors`}
          >
            <LogOut className="w-3.5 h-3.5 shrink-0" />
            {!compactRail && <span>Sign out</span>}
          </button>
        </div>
      </>
    );
  };

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
      <header className="lg:hidden h-11 px-2.5 bg-white border-b border-neutral-200 flex items-center justify-between gap-2 shrink-0 z-30">
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          <button
            type="button"
            onClick={() => setMobileNavOpen(true)}
            className="p-1.5 rounded-lg text-slate-700 hover:bg-slate-100 relative shrink-0"
            aria-label="Open navigation menu"
          >
            <Menu className="w-5 h-5" />
            {pendingApprovalsCount > 0 && (
              <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-amber-500" />
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

        <div className="flex items-center gap-1.5 shrink-0">
          {isActiveAccount &&
            user.role !== "CLIENT" &&
            pathname !== "/dashboard/inbox" && (
              <Link
                href="/dashboard/inbox"
                className="px-2.5 py-1 rounded-lg bg-[#00a884] text-white text-xs font-semibold whitespace-nowrap"
              >
                Chats
              </Link>
            )}
          <span className="hidden sm:inline-flex">
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
            {renderSidebarContent(false)}
          </aside>
        </div>
      )}

      {/* Desktop Fixed Left Sidebar (lg+) with sideways collapse & hide toggles */}
      <aside
        className={`hidden lg:flex ${
          sidebarHidden
            ? "lg:w-0 lg:border-r-0 lg:opacity-0 lg:pointer-events-none"
            : sidebarCollapsed
            ? "lg:w-[68px] border-r border-neutral-200 opacity-100"
            : "lg:w-60 border-r border-neutral-200 opacity-100"
        } lg:h-dvh lg:max-h-dvh lg:sticky lg:top-0 bg-white flex-col shrink-0 overflow-hidden transition-[width,opacity] duration-200`}
      >
        <div
          className={`${
            sidebarCollapsed ? "w-[68px]" : "w-60"
          } h-full flex flex-col overflow-hidden shrink-0`}
        >
          {renderSidebarContent(sidebarCollapsed)}
        </div>
      </aside>

      {sidebarHidden && (
        <button
          type="button"
          onClick={toggleSidebarHidden}
          title="Slide out navigation sidebar"
          aria-label="Show navigation sidebar"
          className="hidden lg:flex fixed left-0 top-1/2 -translate-y-1/2 z-40 h-14 w-5 rounded-r-lg bg-white border border-l-0 border-neutral-300 shadow-md hover:w-7 hover:bg-[#e7fce3] hover:text-[#008069] text-slate-600 items-center justify-center cursor-pointer transition-all"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      )}

      {/* Independent Scrollable Main Workspace */}
      <main className="flex-1 min-h-0 min-w-0 w-full overflow-y-auto overflow-x-hidden flex flex-col">
        {children}
      </main>
    </div>
  );
}
