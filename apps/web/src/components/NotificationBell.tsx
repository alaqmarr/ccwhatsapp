"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  AtSign,
  Bell,
  Bot,
  CheckCheck,
  PhoneCall,
  Volume2,
  VolumeX,
} from "lucide-react";
import {
  dispatchChromeNotification,
  formatInboundMessageNotification,
  formatTabTitleWithUnread,
  getBrowserNotificationPreferences,
  playNotificationChime,
  registerNotificationServiceWorker,
  requestChromeNotificationPermission,
  setChromeNotificationSoundEnabled,
  setChromeNotificationsEnabled,
  shouldShowChromeNotification,
  type BrowserNotifPreferences,
} from "@/lib/browser-notifications";
import { useInboxStore } from "@/lib/inbox-store";
import {
  parseRealtimeEventPayload,
  subscribeRealtimeEvent,
} from "@/lib/realtime-client";

interface Notif {
  id: string;
  type: "MENTION" | "ACRIO_REPLY" | "CALLBACK";
  conversationId: string;
  fromName: string;
  customerName: string;
  text: string;
  isRead: boolean;
  createdAt: string;
}

function timeAgo(iso: string): string {
  const s = Math.max(
    0,
    Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  );
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/**
 * Bell with unread @mentions / ACRIO replies plus Chrome desktop notifications
 * and sound alerts matching web.whatsapp.com across all dashboard tabs.
 */
export function NotificationBell({
  userId,
  userName,
}: {
  userId: string;
  userName?: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;

  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notif[]>([]);
  const [unread, setUnread] = useState(0);
  const [bgUnreadMessages, setBgUnreadMessages] = useState(0);
  const [chromePrefs, setChromePrefs] = useState<BrowserNotifPreferences>(() =>
    getBrowserNotificationPreferences()
  );

  const panelRef = useRef<HTMLDivElement | null>(null);
  const dropRef = useRef<HTMLDivElement | null>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const baseTitleRef = useRef<string>("");
  const [pos, setPos] = useState<{ top: number; left: number; width: number }>({
    top: 80,
    left: 12,
    width: 384,
  });

  const navigateToChat = useCallback(
    (conversationId: string, targetUrl: string) => {
      if (pathnameRef.current === "/dashboard/inbox" && conversationId) {
        window.dispatchEvent(
          new CustomEvent("cc:open-chat", { detail: { conversationId } })
        );
      } else {
        router.push(targetUrl);
      }
    },
    [router]
  );

  const syncPrefs = useCallback(() => {
    setChromePrefs(getBrowserNotificationPreferences());
  }, []);

  // Keep Service Worker active if permission is granted, and listen for notification clicks.
  useEffect(() => {
    syncPrefs();
    if (getBrowserNotificationPreferences().permission === "granted") {
      void registerNotificationServiceWorker();
    }
    if (
      typeof navigator === "undefined" ||
      !("serviceWorker" in navigator)
    ) {
      return;
    }
    const onSwMessage = (ev: MessageEvent) => {
      const data = ev.data as
        | { type?: string; conversationId?: string; url?: string }
        | undefined;
      if (data?.type === "CC_OPEN_CHAT") {
        const cid = String(data.conversationId || "");
        const url = String(
          data.url ||
            (cid
              ? `/dashboard/inbox?chat=${encodeURIComponent(cid)}`
              : "/dashboard/inbox")
        );
        navigateToChat(cid, url);
      }
    };
    navigator.serviceWorker.addEventListener("message", onSwMessage);
    return () => {
      navigator.serviceWorker.removeEventListener("message", onSwMessage);
    };
  }, [navigateToChat, syncPrefs]);

  // Clear background incoming badge and update Chrome tab title when user focuses the tab.
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (!baseTitleRef.current) {
      baseTitleRef.current = document.title.replace(/^\(\d+\)\s+/, "");
    }
    document.title = formatTabTitleWithUnread(
      bgUnreadMessages,
      baseTitleRef.current
    );
  }, [bgUnreadMessages, pathname]);

  useEffect(() => {
    const onFocusOrVisible = () => {
      if (document.visibilityState === "visible" && document.hasFocus()) {
        setBgUnreadMessages(0);
      }
      syncPrefs();
    };
    window.addEventListener("focus", onFocusOrVisible);
    document.addEventListener("visibilitychange", onFocusOrVisible);
    return () => {
      window.removeEventListener("focus", onFocusOrVisible);
      document.removeEventListener("visibilitychange", onFocusOrVisible);
    };
  }, [syncPrefs]);

  // The sidebar is its own stacking layer, so the dropdown renders on body.
  useEffect(() => {
    if (!open) return;
    const place = () => {
      const r = btnRef.current?.getBoundingClientRect();
      const vw = window.innerWidth;
      const width = Math.min(384, vw - 16);
      const left = r ? Math.min(Math.max(8, r.left), vw - width - 8) : 12;
      setPos({ top: (r ? r.bottom : 72) + 8, left, width });
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [open]);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications", { cache: "no-store" });
      const data = await res.json();
      if (data?.ok) {
        setItems(data.notifications || []);
        setUnread(data.unreadCount || 0);
      }
    } catch {
      // ignore transient network errors
    }
  }, []);

  useEffect(() => {
    void load();

    const checkTabFocused = () =>
      typeof document !== "undefined" &&
      document.visibilityState === "visible" &&
      document.hasFocus();

    const maybeNotify = (alert: {
      title: string;
      body: string;
      conversationId?: string;
      tag: string;
      dedupKey?: string;
    }) => {
      const isFocused = checkTabFocused();
      const activeId = useInboxStore.getState().selectedId;
      const shouldPop = shouldShowChromeNotification({
        conversationId: alert.conversationId,
        activeConversationId: activeId,
        pathname: pathnameRef.current,
        isTabVisibleAndFocused: isFocused,
      });
      if (!shouldPop) return;

      if (!isFocused) {
        setBgUnreadMessages((c) => c + 1);
      }
      void dispatchChromeNotification(alert, navigateToChat);
    };

    const unsubMention = subscribeRealtimeEvent(
      "staff:mention",
      (evt: MessageEvent) => {
        const payload = parseRealtimeEventPayload(evt);
        if (payload.staffId !== userId) return;
        void load();

        const nType = String(payload.type || "MENTION");
        const fromName = String(payload.fromName || "Teammate");
        const custName = String(payload.customerName || "Customer");
        const text = String(payload.text || "").slice(0, 140);
        const convId = payload.conversationId
          ? String(payload.conversationId)
          : "";
        maybeNotify({
          title:
            nType === "ACRIO_REPLY"
              ? `ACRIO answered you (${custName})`
              : nType === "CALLBACK"
              ? `New lead or callback: ${custName}`
              : `${fromName} mentioned you`,
          body: text || `Open chat with ${custName}`,
          conversationId: convId,
          tag: `cc-mention-${convId || nType}`,
          dedupKey: `mention:${convId}:${text.slice(0, 32)}`,
        });
      }
    );

    const unsubInbound = subscribeRealtimeEvent(
      "message:new",
      (evt: MessageEvent) => {
        const payload = parseRealtimeEventPayload(evt);
        const alert = formatInboundMessageNotification(payload);
        if (!alert) return;
        maybeNotify(alert);
      }
    );

    const unsubAssigned = subscribeRealtimeEvent(
      "conversation:assigned",
      (evt: MessageEvent) => {
        const payload = parseRealtimeEventPayload(evt);
        const targetStaffId = payload.staffId ? String(payload.staffId) : "";
        const targetStaffName = payload.staffName
          ? String(payload.staffName)
          : payload.assignedStaffName
          ? String(payload.assignedStaffName)
          : "";
        const isForMe =
          (targetStaffId && targetStaffId === userId) ||
          (Boolean(userName) &&
            targetStaffName.toLowerCase() === userName?.toLowerCase());
        if (!isForMe) return;

        const convId = payload.conversationId
          ? String(payload.conversationId)
          : "";
        maybeNotify({
          title: "Chat assigned to you",
          body: "Open Inbox to reply to this customer.",
          conversationId: convId,
          tag: `cc-assign-${convId}`,
          dedupKey: `assign:${convId}:${userId}`,
        });
      }
    );

    return () => {
      unsubMention();
      unsubInbound();
      unsubAssigned();
    };
  }, [load, navigateToChat, userId, userName]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        panelRef.current?.contains(target) ||
        dropRef.current?.contains(target)
      ) {
        return;
      }
      setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  async function markAllRead() {
    await fetch("/api/notifications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    void load();
  }

  async function openItem(n: Notif) {
    setOpen(false);
    if (!n.isRead) {
      await fetch("/api/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [n.id] }),
      });
      void load();
    }
  }

  async function handleEnableChromeAlerts() {
    const res = await requestChromeNotificationPermission();
    syncPrefs();
    if (res === "granted") {
      await dispatchChromeNotification(
        {
          title: "Classic Concepts WhatsApp",
          body: "Chrome notifications are active for new customer messages and leads.",
          tag: "cc-notif-enabled",
          dedupKey: `test:${Date.now()}`,
        },
        navigateToChat
      );
    }
  }

  async function handleSendTestAlert() {
    if (chromePrefs.permission !== "granted") {
      await handleEnableChromeAlerts();
      return;
    }
    if (!chromePrefs.enabled) {
      setChromeNotificationsEnabled(true);
      syncPrefs();
    }
    if (chromePrefs.soundEnabled) {
      playNotificationChime();
    }
    await dispatchChromeNotification(
      {
        title: "Test WhatsApp Alert",
        body: "This is how Chrome alerts look when a customer messages you.",
        tag: "cc-notif-test",
        dedupKey: `test:${Date.now()}`,
      },
      navigateToChat
    );
  }

  return (
    <div className="relative" ref={panelRef}>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="relative p-1.5 rounded-lg text-slate-600 hover:bg-slate-100 cursor-pointer"
        aria-label="Notifications"
      >
        <Bell className="w-4.5 h-4.5" />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-4 h-4 px-1 rounded-full bg-rose-500 text-white text-[9px] font-bold flex items-center justify-center tabular-nums">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={dropRef}
            style={{ top: pos.top, left: pos.left, width: pos.width }}
            className="fixed z-[1000] rounded-xl bg-white border border-neutral-200 shadow-2xl overflow-hidden"
          >
            <div className="px-3.5 py-2.5 border-b border-neutral-200 flex items-center justify-between bg-slate-50">
              <span className="text-sm font-semibold text-slate-900">
                Notifications
              </span>
              <button
                type="button"
                onClick={markAllRead}
                disabled={unread === 0}
                className="text-[11px] font-medium text-[#008069] hover:underline disabled:opacity-40 inline-flex items-center gap-1 cursor-pointer"
              >
                <CheckCheck className="w-3.5 h-3.5" /> Mark all read
              </button>
            </div>

            {chromePrefs.supported && (
              <div className="px-3.5 py-2 border-b border-neutral-200 bg-neutral-50 flex flex-wrap items-center justify-between gap-2 text-[11px]">
                <span className="font-medium text-slate-700">
                  Chrome alerts:{" "}
                  <strong className="text-slate-900">
                    {chromePrefs.permission === "denied"
                      ? "Blocked in Chrome"
                      : chromePrefs.permission !== "granted"
                      ? "Not enabled"
                      : chromePrefs.enabled
                      ? "On"
                      : "Paused"}
                  </strong>
                </span>
                <div className="flex items-center gap-1.5">
                  {chromePrefs.permission === "default" && (
                    <button
                      type="button"
                      onClick={() => void handleEnableChromeAlerts()}
                      className="px-2 py-1 rounded bg-[#00a884] hover:bg-[#008f6f] text-white font-semibold cursor-pointer"
                    >
                      Enable
                    </button>
                  )}
                  {chromePrefs.permission === "granted" && (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          setChromeNotificationsEnabled(!chromePrefs.enabled);
                          syncPrefs();
                        }}
                        className={`px-2 py-1 rounded border font-medium cursor-pointer ${
                          chromePrefs.enabled
                            ? "bg-emerald-50 border-emerald-200 text-emerald-900"
                            : "bg-white border-neutral-300 text-slate-600"
                        }`}
                      >
                        {chromePrefs.enabled ? "Pause" : "Turn on"}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setChromeNotificationSoundEnabled(
                            !chromePrefs.soundEnabled
                          );
                          syncPrefs();
                        }}
                        title={
                          chromePrefs.soundEnabled
                            ? "Mute notification chime"
                            : "Unmute notification chime"
                        }
                        className="p-1 rounded border border-neutral-300 bg-white text-slate-700 hover:bg-neutral-100 cursor-pointer"
                      >
                        {chromePrefs.soundEnabled ? (
                          <Volume2 className="w-3.5 h-3.5 text-[#008069]" />
                        ) : (
                          <VolumeX className="w-3.5 h-3.5 text-slate-400" />
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleSendTestAlert()}
                        className="px-2 py-1 rounded border border-neutral-300 bg-white hover:bg-neutral-100 text-slate-700 font-medium cursor-pointer"
                      >
                        Test
                      </button>
                    </>
                  )}
                </div>
              </div>
            )}

            <div className="max-h-[65dvh] overflow-y-auto divide-y divide-neutral-100">
              {items.length === 0 ? (
                <p className="p-5 text-center text-xs text-neutral-500">
                  Nothing yet. When a teammate writes @{"{your name}"} in a chat
                  note, or ACRIO answers your question, it shows up here.
                </p>
              ) : (
                items.map((n) => (
                  <Link
                    key={n.id}
                    href={`/dashboard/inbox?chat=${encodeURIComponent(
                      n.conversationId
                    )}`}
                    onClick={() => openItem(n)}
                    className={`flex gap-2.5 px-3.5 py-2.5 hover:bg-slate-50 ${
                      n.isRead ? "" : "bg-emerald-50/50"
                    }`}
                  >
                    <span
                      className={`mt-0.5 w-6 h-6 rounded-full shrink-0 flex items-center justify-center ${
                        n.type === "ACRIO_REPLY"
                          ? "bg-violet-100 text-violet-700"
                          : n.type === "CALLBACK"
                          ? "bg-rose-100 text-rose-700"
                          : "bg-amber-100 text-amber-800"
                      }`}
                    >
                      {n.type === "ACRIO_REPLY" ? (
                        <Bot className="w-3.5 h-3.5" />
                      ) : n.type === "CALLBACK" ? (
                        <PhoneCall className="w-3.5 h-3.5" />
                      ) : (
                        <AtSign className="w-3.5 h-3.5" />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2 text-[11.5px]">
                        <span className="font-semibold text-slate-900 truncate">
                          {n.type === "ACRIO_REPLY"
                            ? "ACRIO answered you"
                            : n.type === "CALLBACK"
                            ? "New callback request"
                            : `${n.fromName} mentioned you`}
                        </span>
                        <span className="text-slate-400 shrink-0">
                          {timeAgo(n.createdAt)}
                        </span>
                      </span>
                      <span className="block text-[11px] text-slate-500 truncate">
                        Chat with {n.customerName}
                      </span>
                      <span className="block text-xs text-slate-700 line-clamp-2 mt-0.5 [overflow-wrap:anywhere]">
                        {n.text}
                      </span>
                    </span>
                    {!n.isRead && (
                      <span className="mt-1.5 w-2 h-2 rounded-full bg-rose-500 shrink-0" />
                    )}
                  </Link>
                ))
              )}
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
