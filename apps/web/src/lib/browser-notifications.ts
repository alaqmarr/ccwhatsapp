"use client";

export type BrowserNotifPermissionState =
  | NotificationPermission
  | "unsupported";

export interface BrowserNotifPreferences {
  supported: boolean;
  permission: BrowserNotifPermissionState;
  enabled: boolean;
  soundEnabled: boolean;
  bannerDismissed: boolean;
}

export interface ChromeAlertPayload {
  title: string;
  body: string;
  conversationId?: string;
  tag: string;
  dedupKey?: string;
}

const KEY_ENABLED = "cc_chrome_notif_enabled";
const KEY_SOUND = "cc_chrome_notif_sound";
const KEY_BANNER_DISMISSED = "cc_chrome_notif_dismissed";
const DEDUP_TTL_MS = 12_000;
const recentNotifMap = new Map<string, number>();

let swRegistrationPromise: Promise<ServiceWorkerRegistration | null> | null = null;
let sharedBroadcastChannel: BroadcastChannel | null = null;
const tabLeaderId = `tab_${Math.random().toString(36).slice(2, 10)}`;

function readBoolPref(key: string, defaultValue: boolean): boolean {
  if (typeof window === "undefined") return defaultValue;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return defaultValue;
    return raw === "1";
  } catch {
    return defaultValue;
  }
}

function writeBoolPref(key: string, value: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, value ? "1" : "0");
  } catch {
    // ignore storage quota errors
  }
}

export function isChromeNotificationSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof Notification !== "undefined"
  );
}

export function getBrowserNotificationPreferences(): BrowserNotifPreferences {
  const supported = isChromeNotificationSupported();
  const permission: BrowserNotifPermissionState = supported
    ? Notification.permission
    : "unsupported";
  return {
    supported,
    permission,
    enabled: readBoolPref(KEY_ENABLED, true),
    soundEnabled: readBoolPref(KEY_SOUND, true),
    bannerDismissed: readBoolPref(KEY_BANNER_DISMISSED, false),
  };
}

export function setChromeNotificationsEnabled(next: boolean): void {
  writeBoolPref(KEY_ENABLED, next);
}

export function setChromeNotificationSoundEnabled(next: boolean): void {
  writeBoolPref(KEY_SOUND, next);
}

export function dismissChromeNotificationBanner(): void {
  writeBoolPref(KEY_BANNER_DISMISSED, true);
}

export async function requestChromeNotificationPermission(): Promise<BrowserNotifPermissionState> {
  if (!isChromeNotificationSupported()) return "unsupported";
  try {
    const result = await Notification.requestPermission();
    if (result === "granted") {
      setChromeNotificationsEnabled(true);
      void registerNotificationServiceWorker();
    }
    return result;
  } catch {
    return Notification.permission;
  }
}

export function registerNotificationServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (
    typeof window === "undefined" ||
    typeof navigator === "undefined" ||
    !("serviceWorker" in navigator)
  ) {
    return Promise.resolve(null);
  }
  if (!swRegistrationPromise) {
    swRegistrationPromise = navigator.serviceWorker
      .register("/cc-sw.js", { scope: "/" })
      .catch(() => null);
  }
  return swRegistrationPromise;
}

function getCrossTabChannel(): BroadcastChannel | null {
  if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") {
    return null;
  }
  if (!sharedBroadcastChannel) {
    try {
      sharedBroadcastChannel = new BroadcastChannel("cc-chrome-notifs");
      sharedBroadcastChannel.addEventListener("message", (ev) => {
        const key = ev?.data?.dedupKey;
        if (typeof key === "string" && ev?.data?.sender !== tabLeaderId) {
          recentNotifMap.set(key, Date.now());
        }
      });
    } catch {
      sharedBroadcastChannel = null;
    }
  }
  return sharedBroadcastChannel;
}

function claimNotificationDedupKey(dedupKey: string): boolean {
  const now = Date.now();
  for (const [k, ts] of recentNotifMap.entries()) {
    if (now - ts > DEDUP_TTL_MS) recentNotifMap.delete(k);
  }
  const existing = recentNotifMap.get(dedupKey);
  if (existing && now - existing < DEDUP_TTL_MS) {
    return false;
  }
  recentNotifMap.set(dedupKey, now);
  try {
    getCrossTabChannel()?.postMessage({ dedupKey, sender: tabLeaderId });
  } catch {
    // ignore broadcast error
  }
  return true;
}

/**
 * Formats an inbound WhatsApp message SSE event into a Chrome notification matching
 * web.whatsapp.com (sender name title + clean text/media summary).
 * Returns null for outbound or empty events.
 */
export function formatInboundMessageNotification(
  payload: Record<string, unknown>
): ChromeAlertPayload | null {
  const direction = String(payload.direction || "").toUpperCase();
  if (direction !== "INBOUND") return null;

  const conversationId = payload.conversationId
    ? String(payload.conversationId)
    : "";
  if (!conversationId) return null;

  const customerName = String(payload.customerName || payload.senderName || "").trim();
  const customerPhone = String(payload.customerPhone || "").trim();
  const title = customerName || customerPhone || "New WhatsApp message";

  const messageType = String(payload.messageType || "TEXT").toUpperCase();
  const rawText = String(payload.text || "").replace(/\s+/g, " ").trim();
  const body =
    rawText && !/^\[(?:image|photo|video|document|audio|voice note|sticker)\]$/i.test(rawText)
      ? rawText.slice(0, 140)
      : messageType === "IMAGE"
      ? "Photo"
      : messageType === "VIDEO"
      ? "Video"
      : messageType === "AUDIO"
      ? "Voice message"
      : messageType === "DOCUMENT"
      ? "Document"
      : messageType === "LOCATION"
      ? "Location shared"
      : "Sent you a message";

  const messageId = payload.messageId ? String(payload.messageId) : "";
  return {
    title,
    body,
    conversationId,
    tag: `cc-chat-${conversationId}`,
    dedupKey: messageId
      ? `msg:${messageId}`
      : `chat:${conversationId}:${body.slice(0, 40)}`,
  };
}

/**
 * Follows web.whatsapp.com notification rules: stay quiet when the user is
 * focused on that exact chat, and alert whenever they are in another tab,
 * another app, another page, or another conversation.
 */
export function shouldShowChromeNotification(params: {
  conversationId?: string;
  activeConversationId?: string | null;
  pathname?: string;
  isTabVisibleAndFocused: boolean;
}): boolean {
  if (!params.isTabVisibleAndFocused) return true;
  if (params.pathname !== "/dashboard/inbox") return true;
  if (!params.conversationId) return true;
  return params.conversationId !== (params.activeConversationId || null);
}

/** Plays a short, pleasant two-note notification sound without external media files. */
export function playNotificationChime(): void {
  if (typeof window === "undefined") return;
  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!AudioCtx) return;

  try {
    const ctx = new AudioCtx();
    const now = ctx.currentTime;
    const tones = [1046.5, 1318.5]; // C6 -> E6 soft WhatsApp-like pop
    tones.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, now + i * 0.08);
      gain.gain.setValueAtTime(0.0001, now + i * 0.08);
      gain.gain.exponentialRampToValueAtTime(0.08, now + i * 0.08 + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.08 + 0.14);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + i * 0.08);
      osc.stop(now + i * 0.08 + 0.15);
    });
    setTimeout(() => {
      void ctx.close().catch(() => {});
    }, 500);
  } catch {
    // Ignore autoplay restriction errors before user interaction
  }
}

export function formatTabTitleWithUnread(
  unreadCount: number,
  baseTitle: string
): string {
  const cleanBase = baseTitle.replace(/^\(\d+\)\s+/, "").trim() || "Classic Concepts Portal";
  return unreadCount > 0 ? `(${unreadCount}) ${cleanBase}` : cleanBase;
}

/** Displays a native Chrome desktop notification via the Service Worker or Notification API. */
export async function dispatchChromeNotification(
  alert: ChromeAlertPayload,
  onSelectConversation?: (conversationId: string, targetUrl: string) => void
): Promise<boolean> {
  if (!isChromeNotificationSupported() || Notification.permission !== "granted") {
    return false;
  }
  const prefs = getBrowserNotificationPreferences();
  if (!prefs.enabled) return false;

  const dedupKey = alert.dedupKey || `${alert.tag}:${alert.body.slice(0, 40)}`;
  if (!claimNotificationDedupKey(dedupKey)) {
    return false;
  }

  if (prefs.soundEnabled) {
    playNotificationChime();
  }

  const convId = alert.conversationId || "";
  const targetUrl = convId
    ? `/dashboard/inbox?chat=${encodeURIComponent(convId)}`
    : "/dashboard/inbox";

  try {
    const reg = await registerNotificationServiceWorker();
    if (reg && typeof reg.showNotification === "function") {
      await reg.showNotification(alert.title, {
        body: alert.body,
        icon: "/classic-concepts-icon.png",
        badge: "/classic-concepts-icon.png",
        tag: alert.tag,
        data: { conversationId: convId, url: targetUrl },
      });
      return true;
    }
  } catch {
    // Fall back to direct Notification constructor below
  }

  try {
    const n = new Notification(alert.title, {
      body: alert.body,
      icon: "/classic-concepts-icon.png",
      tag: alert.tag,
    });
    n.onclick = () => {
      try {
        window.focus();
      } catch {
        // ignore focus restriction
      }
      n.close();
      if (onSelectConversation && convId) {
        onSelectConversation(convId, targetUrl);
      } else if (typeof window !== "undefined") {
        window.location.href = targetUrl;
      }
    };
    return true;
  } catch {
    return false;
  }
}
