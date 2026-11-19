export interface Metrics {
  staffId: string;
  name: string;
  role: string;
  openChats: number;
  waitingChats: number;
  resolvedToday: number;
  resolved7d: number;
  resolved30d: number;
  avgFirstResponseSec: number | null;
  medianFirstResponseSec: number | null;
  repliesToday: number;
  replies7d: number;
  assignments30d: number;
  callbacksDone30d: number;
}

export interface Lead {
  id: string;
  customerName: string;
  customerPhone: string;
  category: string;
  priority: string;
  status?: string;
  owner: string;
  isMine: boolean;
  isAcrio: boolean;
  waitingSeconds: number | null;
  unread: number;
  lastMessage: string;
  lastMessageAt: string;
  hasCallback: boolean;
  heat: "HOT" | "WARM" | "NEW";
}

export interface RecentEnquiry {
  id: string;
  brand: "CLASSIC_CONCEPTS" | "CLASSIC_EDGE_53";
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  productName: string;
  message: string;
  status: string;
  createdAt: string;
  repliedByName?: string | null;
}

export interface CallReq {
  id: string;
  conversationId: string;
  customerName: string;
  customerPhone: string;
  slot: string;
  topic: string;
  createdAt: string;
  ownerName: string;
  ageSeconds: number;
}

export interface Notif {
  id: string;
  type: "MENTION" | "ACRIO_REPLY" | "CALLBACK";
  conversationId: string;
  fromName: string;
  customerName: string;
  text: string;
  isRead: boolean;
  createdAt: string;
}

export interface DashboardData {
  generatedAt: string;
  viewer: { id: string; name: string; role: string };
  canSeeTeam: boolean;
  me: Metrics;
  snapshot: {
    openChats: number;
    newChatsToday: number;
    waitingForHuman: number;
    acrioHandling: number;
    unreadMessages: number;
    callbacksPending: number;
    callbacksDoneToday: number;
    hotLeads: number;
    websiteEnquiriesNew?: number;
    websiteEnquiriesTotal?: number;
  };
  openLeads: Lead[];
  recentChats?: Lead[];
  recentEnquiries?: RecentEnquiry[];
  callRequests: CallReq[];
  team: Metrics[];
  notifications: Notif[];
  unreadNotifications: number;
  inboundLast7Days: { day: string; count: number }[];
  leadsByCategory: { category: string; count: number }[];
}

export type LeadTabKey = "MINE" | "HOT" | "WAITING" | "ALL" | "RECENT";

export const heatStyle: Record<string, string> = {
  HOT: "bg-rose-100 text-rose-700",
  WARM: "bg-amber-100 text-amber-800",
  NEW: "bg-sky-100 text-sky-700",
};

export function fmtDuration(sec: number | null | undefined): string {
  if (sec === null || sec === undefined) return "n/a";
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.round(sec / 60)}m`;
  if (sec < 86400) {
    const h = Math.floor(sec / 3600);
    const m = Math.round((sec % 3600) / 60);
    return m ? `${h}h ${m}m` : `${h}h`;
  }
  return `${Math.floor(sec / 86400)}d ${Math.floor((sec % 86400) / 3600)}h`;
}

export function ago(iso: string): string {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  return s < 60 ? "just now" : `${fmtDuration(s)} ago`;
}

export function dayLabel(day: string): string {
  const d = new Date(`${day}T00:00:00`);
  return d.toLocaleDateString("en-IN", { weekday: "short" });
}
