import { NextResponse } from "next/server";
import { formatInTimeZone, fromZonedTime, toZonedTime } from "date-fns-tz";
import { listAllStaffAccounts } from "@cc/auth";
import {
  ensureDatabasesBootstrapped,
  getRawLibSqlClient,
  syncAndListEcosystemEnquiries,
} from "@cc/database";
import { hasPermission } from "@cc/rbac";
import { listCallbackRequests, listStaffNotifications } from "@cc/workers";
import { getCurrentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

const TZ = "Asia/Kolkata";

function median(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? Math.round((s[mid - 1] + s[mid]) / 2) : s[mid];
}
function average(nums: number[]): number | null {
  if (nums.length === 0) return null;
  return Math.round(nums.reduce((a, b) => a + b, 0) / nums.length);
}
const istDay = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : formatInTimeZone(d, TZ, "yyyy-MM-dd");
};

interface StaffMetrics {
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

/** GET /api/dashboard  - everything the /dashboard home screen shows. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user || !hasPermission(user.role, "inbox:view", user.status)) {
    return NextResponse.json({ ok: false, error: "Active staff access required." }, { status: 403 });
  }
  await ensureDatabasesBootstrapped();
  const conv = getRawLibSqlClient("conversations");
  const canSeeTeam = hasPermission(user.role, "analytics:view", user.status);

  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const zonedNow = toZonedTime(new Date(nowMs), TZ);
  zonedNow.setHours(0, 0, 0, 0);
  const todayStartIso = fromZonedTime(zonedNow, TZ).toISOString();
  const cutoff7 = new Date(nowMs - 7 * 86400000).toISOString();
  const cutoff30 = new Date(nowMs - 30 * 86400000).toISOString();

  const [
    openRes,
    recentChatsRes,
    resolvedRes,
    assignRes,
    outboundRes,
    inboundRes,
    newTodayRes,
    callbacksAll,
    notif,
    accounts,
    enquiriesAll,
  ] = await Promise.all([
    conv.execute(
      `SELECT id, customer_name, customer_phone, status, priority, smart_category,
              assigned_staff_id, assigned_staff_name, assigned_team_name, waiting_since,
              unread_count, last_message_preview, last_message_at, created_at
       FROM conversations WHERE status != 'RESOLVED'
       ORDER BY last_message_at DESC LIMIT 500`
    ),
    conv.execute(
      `SELECT id, customer_name, customer_phone, status, priority, smart_category,
              assigned_staff_id, assigned_staff_name, assigned_team_name, waiting_since,
              unread_count, last_message_preview, last_message_at, created_at
       FROM conversations
       ORDER BY last_message_at DESC LIMIT 12`
    ),
    conv.execute({
      sql: `SELECT resolved_by_name, resolved_at FROM conversations
            WHERE status = 'RESOLVED' AND resolved_at >= ?`,
      args: [cutoff30],
    }),
    conv.execute({
      sql: `SELECT to_staff_id, first_response_seconds FROM conversation_assignments WHERE assigned_at >= ?`,
      args: [cutoff30],
    }),
    conv.execute({
      sql: `SELECT sender_name, created_at FROM messages
            WHERE direction = 'OUTBOUND' AND billing_category != 'ACRIO' AND sender_name != 'ACRIO' AND created_at >= ?`,
      args: [cutoff7],
    }),
    conv.execute({
      sql: `SELECT created_at FROM messages WHERE direction = 'INBOUND' AND created_at >= ?`,
      args: [cutoff7],
    }),
    conv.execute({
      sql: `SELECT COUNT(*) AS c FROM conversations WHERE created_at >= ?`,
      args: [todayStartIso],
    }),
    listCallbackRequests(),
    listStaffNotifications(user.id, 8),
    listAllStaffAccounts(),
    syncAndListEcosystemEnquiries({ limit: 50 }).catch(() => []),
  ]);

  const staff = accounts.filter((a) => a.status === "ACTIVE" && a.role !== "CLIENT");
  const nameById = new Map(staff.map((s) => [s.id, s.name]));

  // ---------- Per-staff metrics ----------
  const metricsByStaff = new Map<string, StaffMetrics>();
  const ensure = (id: string, name: string, role: string) => {
    let m = metricsByStaff.get(id);
    if (!m) {
      m = {
        staffId: id,
        name,
        role,
        openChats: 0,
        waitingChats: 0,
        resolvedToday: 0,
        resolved7d: 0,
        resolved30d: 0,
        avgFirstResponseSec: null,
        medianFirstResponseSec: null,
        repliesToday: 0,
        replies7d: 0,
        assignments30d: 0,
        callbacksDone30d: 0,
      };
      metricsByStaff.set(id, m);
    }
    return m;
  };
  for (const s of staff) ensure(s.id, s.name, s.role);
  const byName = new Map(staff.map((s) => [s.name, s.id]));

  for (const r of openRes.rows) {
    const sid = String(r.assigned_staff_id || "");
    if (!sid || sid === "ACRIO") continue;
    const m = ensure(sid, nameById.get(sid) || String(r.assigned_staff_name || sid), "STAFF");
    m.openChats += 1;
    if (r.waiting_since) m.waitingChats += 1;
  }

  const cutoff7Ms = nowMs - 7 * 86400000;
  for (const r of resolvedRes.rows) {
    const sid = byName.get(String(r.resolved_by_name || ""));
    if (!sid) continue;
    const m = metricsByStaff.get(sid)!;
    m.resolved30d += 1;
    const t = new Date(String(r.resolved_at)).getTime();
    if (t >= cutoff7Ms) m.resolved7d += 1;
    if (String(r.resolved_at) >= todayStartIso) m.resolvedToday += 1;
  }

  const responseByStaff = new Map<string, number[]>();
  for (const r of assignRes.rows) {
    const sid = String(r.to_staff_id || "");
    if (!sid || sid === "ACRIO") continue;
    const m = ensure(sid, nameById.get(sid) || sid, "STAFF");
    m.assignments30d += 1;
    if (r.first_response_seconds !== null && r.first_response_seconds !== undefined) {
      const arr = responseByStaff.get(sid) || [];
      arr.push(Number(r.first_response_seconds));
      responseByStaff.set(sid, arr);
    }
  }
  for (const [sid, arr] of responseByStaff) {
    const m = metricsByStaff.get(sid)!;
    m.avgFirstResponseSec = average(arr);
    m.medianFirstResponseSec = median(arr);
  }

  for (const r of outboundRes.rows) {
    const sid = byName.get(String(r.sender_name || ""));
    if (!sid) continue;
    const m = metricsByStaff.get(sid)!;
    m.replies7d += 1;
    if (String(r.created_at) >= todayStartIso) m.repliesToday += 1;
  }

  const callbacks = callbacksAll as Record<string, unknown>[];
  for (const c of callbacks) {
    if (String(c.status) !== "DONE") continue;
    const sid = byName.get(String(c.handled_by || ""));
    if (!sid) continue;
    if (String(c.updated_at || "") >= cutoff30) metricsByStaff.get(sid)!.callbacksDone30d += 1;
  }

  const myMetrics = metricsByStaff.get(user.id) || ensure(user.id, user.name, user.role);

  // ---------- Open leads ----------
  const pendingCallbacks = callbacks.filter((c) => String(c.status) === "PENDING");
  const callbackConvIds = new Set(pendingCallbacks.map((c) => String(c.conversation_id)));
  const openLeads = openRes.rows.map((r) => {
    const id = String(r.id);
    const waitingSince = r.waiting_since ? String(r.waiting_since) : null;
    const owner = String(r.assigned_staff_name || "ACRIO");
    const teamName = String(r.assigned_team_name || "");
    const pinged = /Sales Pinged|Callback/i.test(teamName);
    const hasCallback = callbackConvIds.has(id);
    const priority = String(r.priority || "NORMAL");
    const heat =
      hasCallback || priority === "URGENT" || priority === "HIGH" || pinged
        ? "HOT"
        : waitingSince
        ? "WARM"
        : "NEW";
    return {
      id,
      customerName: String(r.customer_name || r.customer_phone),
      customerPhone: String(r.customer_phone || ""),
      category: String(r.smart_category || "General Enquiry"),
      priority,
      owner,
      ownerId: String(r.assigned_staff_id || ""),
      isMine: String(r.assigned_staff_id || "") === user.id,
      isAcrio: String(r.assigned_staff_id || "ACRIO") === "ACRIO",
      waitingSince,
      waitingSeconds: waitingSince ? Math.max(0, Math.floor((nowMs - new Date(waitingSince).getTime()) / 1000)) : null,
      unread: Number(r.unread_count || 0),
      lastMessage: String(r.last_message_preview || "").slice(0, 140),
      lastMessageAt: String(r.last_message_at || ""),
      hasCallback,
      heat,
    };
  });
  const heatRank = { HOT: 0, WARM: 1, NEW: 2 } as Record<string, number>;
  openLeads.sort(
    (a, b) =>
      heatRank[a.heat] - heatRank[b.heat] ||
      (b.waitingSeconds ?? -1) - (a.waitingSeconds ?? -1) ||
      b.lastMessageAt.localeCompare(a.lastMessageAt)
  );

  // ---------- Call request leads ----------
  const convById = new Map(openLeads.map((l) => [l.id, l]));
  const callRequests = pendingCallbacks
    .map((c) => ({
      id: String(c.id),
      conversationId: String(c.conversation_id),
      customerName: String(c.customer_name || ""),
      customerPhone: String(c.customer_phone || ""),
      slot: String(c.preferred_slot || ""),
      topic: String(c.topic || ""),
      createdAt: String(c.created_at),
      ownerName: convById.get(String(c.conversation_id))?.owner || "ACRIO",
      ageSeconds: Math.max(0, Math.floor((nowMs - new Date(String(c.created_at)).getTime()) / 1000)),
    }))
    .sort((a, b) => b.ageSeconds - a.ageSeconds);
  const callbacksDoneToday = callbacks.filter(
    (c) => String(c.status) === "DONE" && String(c.updated_at || "") >= todayStartIso
  ).length;

  // ---------- Charts ----------
  const days: string[] = [];
  for (let i = 6; i >= 0; i--) days.push(formatInTimeZone(new Date(nowMs - i * 86400000), TZ, "yyyy-MM-dd"));
  const inboundByDay = new Map<string, number>(days.map((d) => [d, 0]));
  for (const r of inboundRes.rows) {
    const k = istDay(String(r.created_at));
    if (inboundByDay.has(k)) inboundByDay.set(k, (inboundByDay.get(k) || 0) + 1);
  }

  const recentChats = recentChatsRes.rows.map((r) => {
    const id = String(r.id);
    const waitingSince = r.waiting_since ? String(r.waiting_since) : null;
    const owner = String(r.assigned_staff_name || "ACRIO");
    const status = String(r.status || "OPEN");
    return {
      id,
      customerName: String(r.customer_name || r.customer_phone),
      customerPhone: String(r.customer_phone || ""),
      category: String(r.smart_category || "General Enquiry"),
      priority: String(r.priority || "NORMAL"),
      status,
      owner,
      isMine: String(r.assigned_staff_id || "") === user.id,
      isAcrio: String(r.assigned_staff_id || "ACRIO") === "ACRIO",
      waitingSeconds: waitingSince
        ? Math.max(0, Math.floor((nowMs - new Date(waitingSince).getTime()) / 1000))
        : null,
      unread: Number(r.unread_count || 0),
      lastMessage: String(r.last_message_preview || "").slice(0, 140),
      lastMessageAt: String(r.last_message_at || ""),
      hasCallback: callbackConvIds.has(id),
      heat: (status === "RESOLVED" ? "NEW" : "WARM") as "HOT" | "WARM" | "NEW",
    };
  });

  const categoryCounts = new Map<string, number>();
  for (const l of openLeads) {
    categoryCounts.set(l.category, (categoryCounts.get(l.category) || 0) + 1);
  }
  if (categoryCounts.size === 0) {
    for (const c of recentChats) {
      categoryCounts.set(c.category, (categoryCounts.get(c.category) || 0) + 1);
    }
    for (const eq of enquiriesAll) {
      const cat = eq.productName
        ? eq.productName
        : eq.brand === "CLASSIC_EDGE_53"
        ? "Classic Edge 53"
        : "Website Enquiry";
      categoryCounts.set(cat, (categoryCounts.get(cat) || 0) + 1);
    }
  }

  const waitingForHuman = openLeads.filter((l) => !l.isAcrio && l.waitingSeconds !== null).length;
  const acrioOpen = openLeads.filter((l) => l.isAcrio).length;
  const unreadTotal = openLeads.reduce((n, l) => n + l.unread, 0);

  const team = canSeeTeam
    ? Array.from(metricsByStaff.values()).sort(
        (a, b) => b.resolved30d - a.resolved30d || b.openChats - a.openChats
      )
    : [];

  const recentEnquiries = enquiriesAll.slice(0, 6).map((e) => ({
    id: e.id,
    brand: e.brand,
    customerName: e.customerName,
    customerEmail: e.customerEmail,
    customerPhone: e.customerPhone,
    productName: e.productName,
    message: e.message.slice(0, 140),
    status: e.status,
    createdAt: e.createdAt,
    repliedByName: e.repliedByName,
  }));
  const newEnquiriesCount = enquiriesAll.filter((e) => e.status === "New").length;

  return NextResponse.json({
    ok: true,
    generatedAt: nowIso,
    viewer: { id: user.id, name: user.name, role: user.role },
    canSeeTeam,
    me: myMetrics,
    snapshot: {
      openChats: openLeads.length,
      newChatsToday: Number(newTodayRes.rows[0]?.c || 0),
      waitingForHuman,
      acrioHandling: acrioOpen,
      unreadMessages: unreadTotal,
      callbacksPending: callRequests.length,
      callbacksDoneToday,
      hotLeads: openLeads.filter((l) => l.heat === "HOT").length,
      websiteEnquiriesNew: newEnquiriesCount,
      websiteEnquiriesTotal: enquiriesAll.length,
    },
    openLeads: openLeads.slice(0, 60),
    recentChats,
    recentEnquiries,
    callRequests,
    team,
    notifications: notif.notifications,
    unreadNotifications: notif.unreadCount,
    inboundLast7Days: days.map((d) => ({ day: d, count: inboundByDay.get(d) || 0 })),
    leadsByCategory: Array.from(categoryCounts.entries())
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count),
  });
}
