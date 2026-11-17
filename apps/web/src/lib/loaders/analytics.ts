import { formatInTimeZone, toZonedTime, fromZonedTime } from "date-fns-tz";
import {
  ensureDatabasesBootstrapped,
  getRawLibSqlClient,
  readAiTraceLogs,
} from "@cc/database";
import { canViewCostBreakdown, hasPermission, isDevRole } from "@cc/rbac";
import { checkAndEscalateWaitingChats } from "@cc/workers";
import type { AuthenticatedUser } from "@cc/auth";

function computeMedian(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return Math.round((sorted[mid - 1] + sorted[mid]) / 2);
  }
  return sorted[mid];
}

function computeAverage(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const sum = nums.reduce((acc, v) => acc + v, 0);
  return Math.round(sum / nums.length);
}

const APP_TIMEZONE = "Asia/Kolkata";

function toIstDateKey(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return formatInTimeZone(d, APP_TIMEZONE, "yyyy-MM-dd");
}

function toIstHour(iso: string): number | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const zoned = toZonedTime(d, APP_TIMEZONE);
  return zoned.getHours();
}

function formatHourLabel(h: number): string {
  if (h === 0) return "12 AM";
  if (h < 12) return `${h} AM`;
  if (h === 12) return "12 PM";
  return `${h - 12} PM`;
}

export async function loadAnalyticsPayload(
  user: AuthenticatedUser,
  opts?: {
    range?: string;
    teamId?: string;
    scope?: string | null;
  }
) {
  await ensureDatabasesBootstrapped();
  await checkAndEscalateWaitingChats().catch(() => {});

  const range = (opts?.range || "30d").toLowerCase();
  const teamFilter = opts?.teamId || "ALL";

  const nowMs = Date.now();
  let cutoffIso = "1970-01-01T00:00:00.000Z";
  let daysSpan = 30;

  if (range === "today") {
    // Start of current IST day
    const dateKey = formatInTimeZone(new Date(nowMs), APP_TIMEZONE, "yyyy-MM-dd");
    const startOfIstDay = fromZonedTime(`${dateKey} 00:00:00`, APP_TIMEZONE);
    cutoffIso = startOfIstDay.toISOString();
    daysSpan = 1;
  } else if (range === "7d") {
    cutoffIso = new Date(nowMs - 7 * 24 * 60 * 60 * 1000).toISOString();
    daysSpan = 7;
  } else if (range === "30d") {
    cutoffIso = new Date(nowMs - 30 * 24 * 60 * 60 * 1000).toISOString();
    daysSpan = 30;
  } else if (range === "90d") {
    cutoffIso = new Date(nowMs - 90 * 24 * 60 * 60 * 1000).toISOString();
    daysSpan = 90;
  } else {
    cutoffIso = "1970-01-01T00:00:00.000Z";
    daysSpan = 30;
  }

  const conv = getRawLibSqlClient("conversations");
  const crm = getRawLibSqlClient("crm_orders");
  const mkt = getRawLibSqlClient("marketing");
  const bill = getRawLibSqlClient("billing_ops");
  const auth = getRawLibSqlClient("core_auth");

  const [
    convsRes,
    msgsRes,
    assignRes,
    teamsRes,
    linksRes,
    customersRes,
    ordersRes,
    templatesRes,
    broadcastsRes,
    ledgerRes,
    usersRes,
  ] = await Promise.all([
    conv.execute(`SELECT * FROM conversations ORDER BY last_message_at DESC`),
    conv.execute(
      `SELECT id, conversation_id, direction, sender_type, sender_staff_id, sender_name, message_type, billing_category, delivery_status, created_at
       FROM messages
       WHERE created_at >= ?
       ORDER BY created_at ASC`,
      [cutoffIso]
    ),
    conv.execute(
      `SELECT * FROM conversation_assignments
       WHERE assigned_at >= ?
       ORDER BY assigned_at DESC`,
      [cutoffIso]
    ),
    conv.execute(`SELECT * FROM teams ORDER BY priority_rank ASC, name ASC`),
    conv.execute(
      `SELECT id, code, title, target_url, link_type, clicks_count, last_clicked_at
       FROM custom_links
       ORDER BY clicks_count DESC, created_at DESC`
    ),
    crm.execute(
      `SELECT id, organization_type, opt_in_marketing, lifetime_value_inr, total_orders_count, created_at
       FROM customers`
    ),
    crm.execute(
      `SELECT id, order_number, customer_phone, items_summary, quantity, total_amount_inr, payment_status, fulfillment_status, ordered_at
       FROM customer_orders
       WHERE ordered_at >= ?
       ORDER BY ordered_at DESC`,
      [cutoffIso]
    ),
    mkt.execute(
      `SELECT id, name, category, approval_status, meta_quality_score, sent_count
       FROM templates
       ORDER BY sent_count DESC, name ASC`
    ),
    mkt.execute(
      `SELECT id, name, status, total_recipients, sent_count, delivered_count, read_count, skipped_count, failed_count, client_billed_inr, actual_meta_cost_inr, created_at
       FROM broadcasts
       WHERE created_at >= ?
       ORDER BY created_at DESC`,
      [cutoffIso]
    ),
    bill.execute(
      `SELECT id, category, client_unit_rate_inr, actual_meta_unit_cost_inr, margin_inr, staff_name, billed_at
       FROM message_billing_ledger
       WHERE billed_at >= ?
       ORDER BY billed_at DESC`,
      [cutoffIso]
    ),
    auth.execute(
      `SELECT id, name, email, role, department, status
       FROM users
       WHERE status = 'ACTIVE' AND role != 'CLIENT'
       ORDER BY name ASC`
    ),
  ]);

  const requestedScope = opts?.scope ?? null;
  const canViewBilling = canViewCostBreakdown(user.role);
  const isDevPricing = isDevRole(user.role) && requestedScope === "dev";
  const pricingMode = isDevPricing
    ? "dev_actual_and_margin"
    : canViewBilling
    ? "client_set_pricing"
    : "hidden";

  // Map conversations for quick team filtering
  const convTeamMap = new Map<string, string | null>();
  for (const c of convsRes.rows) {
    convTeamMap.set(
      String(c.id),
      c.assigned_team_id ? String(c.assigned_team_id) : null
    );
  }

  const allConvs = convsRes.rows.filter((c) => {
    if (
      teamFilter !== "ALL" &&
      String(c.assigned_team_id || "") !== teamFilter
    ) {
      return false;
    }
    return true;
  });

  const periodConvs = allConvs.filter(
    (c) =>
      String(c.last_message_at || c.created_at) >= cutoffIso ||
      String(c.created_at) >= cutoffIso
  );

  // Live snapshot counts across active conversations (filtered by team if chosen)
  let openChatsCount = 0;
  let assignedChatsCount = 0;
  let resolvedChatsCount = 0;
  let waitingNowCount = 0;
  let waitingP0Count = 0;
  let waitingP1Count = 0;
  let waitingP2Count = 0;
  let acrioLiveChatsCount = 0;

  const userIdByLowerName = new Map<string, string>();
  const teamNamesLower = new Set<string>();
  for (const u of usersRes.rows) {
    userIdByLowerName.set(String(u.name || "").trim().toLowerCase(), String(u.id));
  }
  for (const t of teamsRes.rows) {
    teamNamesLower.add(String(t.name || "").trim().toLowerCase());
  }

  const categoryCounts = new Map<string, number>();
  const priorityCounts = new Map<string, number>();
  const openLoadByStaff = new Map<string, number>();
  const resolvedByStaffName = new Map<string, number>();
  const resolvedByStaffId = new Map<string, number>();

  for (const c of allConvs) {
    const st = String(c.status || "OPEN");
    const staffId = c.assigned_staff_id ? String(c.assigned_staff_id) : "ACRIO";
    const esc = String(c.escalation_level || "P0");
    if (st === "RESOLVED") {
      resolvedChatsCount++;
      const explicitResId = c.resolved_by_id ? String(c.resolved_by_id) : "";
      const rName = c.resolved_by_name ? String(c.resolved_by_name).trim() : "";
      if (rName) {
        resolvedByStaffName.set(rName, (resolvedByStaffName.get(rName) || 0) + 1);
      }
      const mappedUid =
        explicitResId || (rName ? userIdByLowerName.get(rName.toLowerCase()) || "" : "");
      if (mappedUid) {
        resolvedByStaffId.set(mappedUid, (resolvedByStaffId.get(mappedUid) || 0) + 1);
      }
    } else {
      if (st === "ASSIGNED") assignedChatsCount++;
      else openChatsCount++;

      openLoadByStaff.set(staffId, (openLoadByStaff.get(staffId) || 0) + 1);
      if (staffId === "ACRIO") acrioLiveChatsCount++;

      if (c.waiting_since && staffId !== "ACRIO") {
        waitingNowCount++;
        if (esc === "P2") waitingP2Count++;
        else if (esc === "P1") waitingP1Count++;
        else waitingP0Count++;
      }
    }
  }

  for (const c of periodConvs) {
    const cat = String(c.smart_category || "General Enquiry");
    const pri = String(c.priority || "NORMAL");
    categoryCounts.set(cat, (categoryCounts.get(cat) || 0) + 1);
    priorityCounts.set(pri, (priorityCounts.get(pri) || 0) + 1);
  }

  // Filter assignments by team if selected
  const filteredAssignments = assignRes.rows.filter((a) => {
    if (teamFilter === "ALL") return true;
    return String(a.to_team_id || "") === teamFilter;
  });

  const humanAssignments = filteredAssignments.filter(
    (a) => String(a.to_staff_id || "") !== "ACRIO"
  );
  const acrioAssignments = filteredAssignments.filter(
    (a) => String(a.to_staff_id || "") === "ACRIO"
  );

  const humanResponseTimes: number[] = [];
  let humanRespondedCount = 0;
  let humanUnder5MinCount = 0;
  let autoEscalationsCount = 0;

  for (const a of humanAssignments) {
    if (String(a.assignment_source) === "AUTO_ESCALATION") {
      autoEscalationsCount++;
    }
    if (
      a.first_response_at &&
      a.first_response_seconds !== null &&
      a.first_response_seconds !== undefined
    ) {
      const secs = Number(a.first_response_seconds);
      humanRespondedCount++;
      humanResponseTimes.push(secs);
      if (secs <= 300) humanUnder5MinCount++;
    }
  }

  // ACRIO autonomous handling: conversations in period that had an ACRIO assignment and NO human assignment
  const convIdsWithHumanAsg = new Set(
    humanAssignments.map((a) => String(a.conversation_id))
  );
  const convIdsWithAcrioAsg = new Set(
    acrioAssignments.map((a) => String(a.conversation_id))
  );
  let acrioAutonomousChats = 0;
  for (const cid of convIdsWithAcrioAsg) {
    if (!convIdsWithHumanAsg.has(cid)) {
      acrioAutonomousChats++;
    }
  }
  const acrioRespTimes = acrioAssignments
    .filter(
      (a) =>
        a.first_response_at &&
        a.first_response_seconds !== null &&
        a.first_response_seconds !== undefined
    )
    .map((a) => Number(a.first_response_seconds));

  // Filter messages by team if selected
  const filteredMsgs = msgsRes.rows.filter((m) => {
    if (teamFilter === "ALL") return true;
    return convTeamMap.get(String(m.conversation_id)) === teamFilter;
  });

  let inboundMessagesCount = 0;
  let outboundMessagesCount = 0;
  let freeStaffRepliesCount = 0;
  let acrioRepliesCount = 0;
  let templateMessagesCount = 0;
  let internalNotesCount = 0;

  const tickCounts = {
    sending: 0,
    sent: 0,
    delivered: 0,
    read: 0,
    failed: 0,
  };

  const hourlyIst = Array.from({ length: 24 }, (_, h) => ({
    hour: h,
    label: formatHourLabel(h),
    inboundCount: 0,
    outboundCount: 0,
  }));

  const staffOutboundRepliesByName = new Map<string, number>();
  const staffOutboundRepliesById = new Map<string, number>();

  for (const m of filteredMsgs) {
    const dir = String(m.direction);
    const mType = String(m.message_type);
    const bCat = String(m.billing_category);
    const dStat = String(m.delivery_status || "SENT").toUpperCase();
    const createdIso = String(m.created_at);

    if (dir === "INBOUND") {
      inboundMessagesCount++;
      const hr = toIstHour(createdIso);
      if (hr !== null) hourlyIst[hr].inboundCount++;
    } else if (dir === "OUTBOUND") {
      outboundMessagesCount++;
      const hr = toIstHour(createdIso);
      if (hr !== null) hourlyIst[hr].outboundCount++;

      if (bCat === "ACRIO") {
        acrioRepliesCount++;
      } else if (mType === "TEMPLATE") {
        templateMessagesCount++;
      } else {
        freeStaffRepliesCount++;
      }

      const sName = String(m.sender_name || "").trim();
      const sStaffId = m.sender_staff_id
        ? String(m.sender_staff_id)
        : sName
        ? userIdByLowerName.get(sName.toLowerCase()) || ""
        : "";
      if (sName) {
        staffOutboundRepliesByName.set(
          sName,
          (staffOutboundRepliesByName.get(sName) || 0) + 1
        );
      }
      if (sStaffId) {
        staffOutboundRepliesById.set(
          sStaffId,
          (staffOutboundRepliesById.get(sStaffId) || 0) + 1
        );
      }

      if (dStat === "SENDING") tickCounts.sending++;
      else if (dStat === "SENT") tickCounts.sent++;
      else if (dStat === "DELIVERED") tickCounts.delivered++;
      else if (dStat === "READ") tickCounts.read++;
      else if (dStat === "FAILED") tickCounts.failed++;
      else tickCounts.delivered++;
    } else if (mType === "INTERNAL_NOTE") {
      internalNotesCount++;
    }
  }

  // Daily time-series (capped to last 30 points for crisp chart rendering, or 1..daysSpan)
  const chartDays = Math.min(daysSpan, 30);
  const dailyMap = new Map<
    string,
    {
      date: string;
      label: string;
      inboundMessages: number;
      outboundMessages: number;
      newConversations: number;
      resolvedConversations: number;
      humanAssignments: number;
      respSecList: number[];
    }
  >();

  for (let i = chartDays - 1; i >= 0; i--) {
    const dMs = nowMs - i * 24 * 60 * 60 * 1000;
    const key = toIstDateKey(new Date(dMs).toISOString());
    const parsed = fromZonedTime(`${key} 00:00:00`, APP_TIMEZONE);
    const label = formatInTimeZone(parsed, APP_TIMEZONE, "d MMM");
    dailyMap.set(key, {
      date: key,
      label,
      inboundMessages: 0,
      outboundMessages: 0,
      newConversations: 0,
      resolvedConversations: 0,
      humanAssignments: 0,
      respSecList: [],
    });
  }

  for (const m of filteredMsgs) {
    const key = toIstDateKey(String(m.created_at));
    const bucket = dailyMap.get(key);
    if (!bucket) continue;
    if (String(m.direction) === "INBOUND") bucket.inboundMessages++;
    else if (String(m.direction) === "OUTBOUND") bucket.outboundMessages++;
  }

  for (const c of allConvs) {
    const cKey = toIstDateKey(String(c.created_at));
    const cBucket = dailyMap.get(cKey);
    if (cBucket) cBucket.newConversations++;

    if (c.resolved_at) {
      const rKey = toIstDateKey(String(c.resolved_at));
      const rBucket = dailyMap.get(rKey);
      if (rBucket) rBucket.resolvedConversations++;
    }
  }

  for (const a of humanAssignments) {
    const aKey = toIstDateKey(String(a.assigned_at));
    const aBucket = dailyMap.get(aKey);
    if (!aBucket) continue;
    aBucket.humanAssignments++;
    if (
      a.first_response_at &&
      a.first_response_seconds !== null &&
      a.first_response_seconds !== undefined
    ) {
      aBucket.respSecList.push(Number(a.first_response_seconds));
    }
  }

  const dailySeries = Array.from(dailyMap.values()).map((d) => ({
    date: d.date,
    label: d.label,
    inboundMessages: d.inboundMessages,
    outboundMessages: d.outboundMessages,
    newConversations: d.newConversations,
    resolvedConversations: d.resolvedConversations,
    humanAssignments: d.humanAssignments,
    avgFirstResponseSeconds: computeAverage(d.respSecList),
  }));

  // Agent Leaderboard (Active Staff + System ACRIO)
  const agentStatsMap = new Map<
    string,
    {
      staffId: string;
      staffName: string;
      role: string;
      department: string;
      isSystem: boolean;
      assignmentsCount: number;
      respondedCount: number;
      responseSecs: number[];
      under5MinCount: number;
      escalatedCount: number;
      reassignedCount: number;
    }
  >();

  agentStatsMap.set("ACRIO", {
    staffId: "ACRIO",
    staffName: "System (ACRIO)",
    role: "SYSTEM_AI",
    department: "Automated Concierge",
    isSystem: true,
    assignmentsCount: 0,
    respondedCount: 0,
    responseSecs: [],
    under5MinCount: 0,
    escalatedCount: 0,
    reassignedCount: 0,
  });

  for (const u of usersRes.rows) {
    const uid = String(u.id);
    agentStatsMap.set(uid, {
      staffId: uid,
      staffName: String(u.name),
      role: String(u.role),
      department: String(u.department || "Sales Team"),
      isSystem: false,
      assignmentsCount: 0,
      respondedCount: 0,
      responseSecs: [],
      under5MinCount: 0,
      escalatedCount: 0,
      reassignedCount: 0,
    });
  }

  for (const a of filteredAssignments) {
    const rawSid = a.to_staff_id ? String(a.to_staff_id) : "";
    const sName = String(a.to_staff_name || "").trim();
    const sid =
      rawSid ||
      (sName && !teamNamesLower.has(sName.toLowerCase())
        ? userIdByLowerName.get(sName.toLowerCase()) || ""
        : "");

    // Never count team queues ("Sales Team" / "UNASSIGNED") as an individual person!
    if (!sid || sid === "UNASSIGNED" || teamNamesLower.has(sName.toLowerCase())) {
      continue;
    }

    if (!agentStatsMap.has(sid)) {
      agentStatsMap.set(sid, {
        staffId: sid,
        staffName: sName || "Team Member",
        role: sid === "ACRIO" ? "SYSTEM_AI" : "STAFF",
        department: String(a.to_team_name || "Sales Team"),
        isSystem: sid === "ACRIO",
        assignmentsCount: 0,
        respondedCount: 0,
        responseSecs: [],
        under5MinCount: 0,
        escalatedCount: 0,
        reassignedCount: 0,
      });
    }
    const st = agentStatsMap.get(sid)!;
    st.assignmentsCount++;
    if (
      a.first_response_at &&
      a.first_response_seconds !== null &&
      a.first_response_seconds !== undefined
    ) {
      const secs = Number(a.first_response_seconds);
      st.respondedCount++;
      st.responseSecs.push(secs);
      if (secs <= 300) st.under5MinCount++;
    }
    const outcome = String(a.outcome || "");
    if (outcome === "ESCALATED") st.escalatedCount++;
    else if (outcome === "REASSIGNED") st.reassignedCount++;
  }

  const agentLeaderboard = Array.from(agentStatsMap.values())
    .map((ag) => {
      const avg = computeAverage(ag.responseSecs);
      const med = computeMedian(ag.responseSecs);
      const fastest =
        ag.responseSecs.length > 0 ? Math.min(...ag.responseSecs) : null;
      const slowest =
        ag.responseSecs.length > 0 ? Math.max(...ag.responseSecs) : null;
      const responseRatePct =
        ag.assignmentsCount > 0
          ? Math.round((ag.respondedCount / ag.assignmentsCount) * 100)
          : 0;
      const under5MinPct =
        ag.respondedCount > 0
          ? Math.round((ag.under5MinCount / ag.respondedCount) * 100)
          : 0;
      const repliesSent = ag.isSystem
        ? acrioRepliesCount
        : staffOutboundRepliesById.get(ag.staffId) ??
          staffOutboundRepliesByName.get(ag.staffName) ??
          0;
      const resolvedCount = ag.isSystem
        ? resolvedByStaffName.get("ACRIO Smart Resolution") || 0
        : resolvedByStaffId.get(ag.staffId) ??
          resolvedByStaffName.get(ag.staffName) ??
          0;

      return {
        staffId: ag.staffId,
        staffName: ag.staffName,
        role: ag.role,
        department: ag.department,
        isSystem: ag.isSystem,
        assignmentsCount: ag.assignmentsCount,
        respondedCount: ag.respondedCount,
        responseRatePct,
        avgFirstResponseSeconds: avg,
        medianFirstResponseSeconds: med,
        fastestFirstResponseSeconds: fastest,
        slowestFirstResponseSeconds: slowest,
        under5MinPct,
        escalatedCount: ag.escalatedCount,
        reassignedCount: ag.reassignedCount,
        activeOpenChats: openLoadByStaff.get(ag.staffId) || 0,
        outboundRepliesSent: repliesSent,
        resolvedCount,
      };
    })
    .sort((a, b) => {
      if (a.isSystem !== b.isSystem) return a.isSystem ? 1 : -1;
      if (b.assignmentsCount !== a.assignmentsCount) {
        return b.assignmentsCount - a.assignmentsCount;
      }
      return b.outboundRepliesSent - a.outboundRepliesSent;
    });

  // Team SLA & Escalation Breakdown
  const teamBreakdown = teamsRes.rows.map((t) => {
    const tid = String(t.id);
    const tName = String(t.name);
    const teamAsgs = assignRes.rows.filter(
      (a) => String(a.to_team_id || "") === tid
    );
    const respSecs: number[] = [];
    let responded = 0;
    let p0Count = 0;
    let p1Count = 0;
    let p2Count = 0;
    let escalated = 0;

    for (const a of teamAsgs) {
      const lv = String(a.escalation_level || "P0");
      if (lv === "P2") p2Count++;
      else if (lv === "P1") p1Count++;
      else p0Count++;

      if (String(a.outcome) === "ESCALATED") escalated++;
      if (
        a.first_response_at &&
        a.first_response_seconds !== null &&
        a.first_response_seconds !== undefined
      ) {
        responded++;
        respSecs.push(Number(a.first_response_seconds));
      }
    }

    const teamConvs = convsRes.rows.filter(
      (c) =>
        String(c.assigned_team_id || "") === tid &&
        String(c.status) !== "RESOLVED"
    );
    const waiting = teamConvs.filter((c) => Boolean(c.waiting_since)).length;

    return {
      teamId: tid,
      teamName: tName,
      brandScope: String(t.brand_scope || "ALL"),
      p0WaitMinutes: Number(t.p0_wait_minutes ?? 5),
      p1WaitMinutes: Number(t.p1_wait_minutes ?? 12),
      assignmentsCount: teamAsgs.length,
      respondedCount: responded,
      avgFirstResponseSeconds: computeAverage(respSecs),
      p0Count,
      p1Count,
      p2Count,
      escalatedCount: escalated,
      openChatsCount: teamConvs.length,
      currentlyWaitingCount: waiting,
    };
  });

  // CRM & Orders Summary
  let optedInCustomers = 0;
  let optedOutCustomers = 0;
  const segmentCounts = new Map<string, number>();
  for (const c of customersRes.rows) {
    if (Number(c.opt_in_marketing ?? 1) === 1) optedInCustomers++;
    else optedOutCustomers++;
    const seg = String(c.organization_type || "Business");
    segmentCounts.set(seg, (segmentCounts.get(seg) || 0) + 1);
  }

  let ordersRevenueInr = 0;
  let paidOrdersRevenueInr = 0;
  for (const o of ordersRes.rows) {
    const amt = Number(o.total_amount_inr ?? 0);
    ordersRevenueInr += amt;
    const payStatus = String(o.payment_status || "");
    if (payStatus === "PAID" || payStatus === "ADVANCE_PAID") {
      paidOrdersRevenueInr += amt;
    }
  }

  // Broadcasts Summary
  let bcTotalRecipients = 0;
  let bcSent = 0;
  let bcDelivered = 0;
  let bcRead = 0;
  let bcSkipped = 0;
  let bcFailed = 0;
  for (const b of broadcastsRes.rows) {
    bcTotalRecipients += Number(b.total_recipients ?? 0);
    bcSent += Number(b.sent_count ?? 0);
    bcDelivered += Number(b.delivered_count ?? 0);
    bcRead += Number(b.read_count ?? 0);
    bcSkipped += Number(b.skipped_count ?? 0);
    bcFailed += Number(b.failed_count ?? 0);
  }

  // Dual-Pricing Billing Summary (Role-Isolated!)
  let totalClientBilledInr = 0;
  let totalActualMetaCostInr = 0;
  let totalNetMarginInr = 0;
  const billingByCategory: Record<
    string,
    {
      count: number;
      clientBilledInr: number;
      actualMetaCostInr?: number;
      marginInr?: number;
    }
  > = {
    FREE_CHAT: {
      count: freeStaffRepliesCount,
      clientBilledInr: 0,
      ...(isDevPricing ? { actualMetaCostInr: 0, marginInr: 0 } : {}),
    },
    ACRIO: {
      count: 0,
      clientBilledInr: 0,
      ...(isDevPricing ? { actualMetaCostInr: 0, marginInr: 0 } : {}),
    },
    MARKETING: {
      count: 0,
      clientBilledInr: 0,
      ...(isDevPricing ? { actualMetaCostInr: 0, marginInr: 0 } : {}),
    },
    UTILITY: {
      count: 0,
      clientBilledInr: 0,
      ...(isDevPricing ? { actualMetaCostInr: 0, marginInr: 0 } : {}),
    },
    AUTHENTICATION: {
      count: 0,
      clientBilledInr: 0,
      ...(isDevPricing ? { actualMetaCostInr: 0, marginInr: 0 } : {}),
    },
  };

  for (const l of ledgerRes.rows) {
    const cat = String(l.category || "UTILITY").toUpperCase();
    const clientAmt = Number(l.client_unit_rate_inr ?? 0);
    const metaAmt = Number(l.actual_meta_unit_cost_inr ?? 0);
    const marginAmt = Number(l.margin_inr ?? 0);

    totalClientBilledInr += clientAmt;
    totalActualMetaCostInr += metaAmt;
    totalNetMarginInr += marginAmt;

    const bucket =
      billingByCategory[cat] ||
      (billingByCategory[cat] = {
        count: 0,
        clientBilledInr: 0,
        ...(isDevPricing ? { actualMetaCostInr: 0, marginInr: 0 } : {}),
      });
    bucket.count++;
    bucket.clientBilledInr = Number(
      (bucket.clientBilledInr + clientAmt).toFixed(2)
    );
    if (isDevPricing) {
      bucket.actualMetaCostInr = Number(
        ((bucket.actualMetaCostInr || 0) + metaAmt).toFixed(4)
      );
      bucket.marginInr = Number(
        ((bucket.marginInr || 0) + marginAmt).toFixed(4)
      );
    }
  }

  const totalConvsCount = allConvs.length;
  const resolutionRatePct =
    totalConvsCount > 0
      ? Math.round((resolvedChatsCount / totalConvsCount) * 100)
      : 0;
  const humanResponseRatePct =
    humanAssignments.length > 0
      ? Math.round((humanRespondedCount / humanAssignments.length) * 100)
      : 0;
  const slaUnder5MinPct =
    humanRespondedCount > 0
      ? Math.round((humanUnder5MinCount / humanRespondedCount) * 100)
      : 100;
  const escalationRatePct =
    humanAssignments.length > 0
      ? Math.round((autoEscalationsCount / humanAssignments.length) * 100)
      : 0;
  const acrioAutonomousRatePct =
    convIdsWithAcrioAsg.size > 0
      ? Math.round((acrioAutonomousChats / convIdsWithAcrioAsg.size) * 100)
      : 0;

  const deliveredOrReadCount = tickCounts.delivered + tickCounts.read;
  const outboundDeliveryRatePct =
    outboundMessagesCount > 0
      ? Math.round((deliveredOrReadCount / outboundMessagesCount) * 100)
      : 0;
  const outboundReadRatePct =
    outboundMessagesCount > 0
      ? Math.round((tickCounts.read / outboundMessagesCount) * 100)
      : 0;

  const assignmentLogs = filteredAssignments.slice(0, 120).map((a) => ({
    id: String(a.id),
    conversationId: String(a.conversation_id),
    customerPhone: String(a.customer_phone || ""),
    customerName: String(a.customer_name || ""),
    fromStaffName: a.from_staff_name ? String(a.from_staff_name) : null,
    fromTeamName: a.from_team_name ? String(a.from_team_name) : null,
    toStaffId: a.to_staff_id ? String(a.to_staff_id) : null,
    toStaffName: String(a.to_staff_name || ""),
    toTeamId: a.to_team_id ? String(a.to_team_id) : null,
    toTeamName: String(a.to_team_name || ""),
    escalationLevel: String(a.escalation_level || "P0"),
    assignmentSource: String(a.assignment_source || "MANUAL_ASSIGN"),
    assignedByName: String(a.assigned_by_name || "System"),
    reason: String(a.reason || ""),
    assignedAt: String(a.assigned_at),
    firstResponseAt: a.first_response_at ? String(a.first_response_at) : null,
    firstResponseSeconds:
      a.first_response_seconds !== null && a.first_response_seconds !== undefined
        ? Number(a.first_response_seconds)
        : null,
    endedAt: a.ended_at ? String(a.ended_at) : null,
    outcome: String(a.outcome || "ACTIVE"),
  }));

  // Aggregate AI Tokens In & Out across all 3 ecosystem websites for the selected period
  const aiLogsReport = readAiTraceLogs({
    sinceUtc: cutoffIso,
    limit: 5000,
  });
  let aiTokensIn = 0;
  let aiTokensOut = 0;
  let aiCacheReadTokens = 0;
  let aiLiveCallsCount = 0;
  const aiTokensByWebsite = {
    WHATSAPP_HUB: { inputTokens: 0, outputTokens: 0, calls: 0 },
    CLASSIC_CONCEPTS: { inputTokens: 0, outputTokens: 0, calls: 0 },
    CLASSIC_EDGE_53: { inputTokens: 0, outputTokens: 0, calls: 0 },
  };
  for (const entry of aiLogsReport.entries) {
    const tIn = Number(entry.tokenUsage?.inputTokens ?? 0) || 0;
    const tOut = Number(entry.tokenUsage?.outputTokens ?? 0) || 0;
    const tCache = Number(entry.tokenUsage?.cacheReadInputTokens ?? 0) || 0;
    aiTokensIn += tIn;
    aiTokensOut += tOut;
    aiCacheReadTokens += tCache;
    if (entry.outcomeSource === "LIVE_AI") {
      aiLiveCallsCount++;
    }
    if (entry.website in aiTokensByWebsite) {
      aiTokensByWebsite[entry.website].inputTokens += tIn;
      aiTokensByWebsite[entry.website].outputTokens += tOut;
      if (tIn > 0 || tOut > 0 || entry.outcomeSource === "LIVE_AI") {
        aiTokensByWebsite[entry.website].calls++;
      }
    }
  }
  const aiTokensTotal = aiTokensIn + aiTokensOut;

  return {
    ok: true,
    range,
    teamFilter,
    pricingMode,
    canViewBilling,
    generatedAt: new Date().toISOString(),
    teams: teamsRes.rows.map((t) => ({
      id: String(t.id),
      name: String(t.name),
    })),
    kpis: {
      totalConversations: totalConvsCount,
      openConversations: openChatsCount,
      assignedConversations: assignedChatsCount,
      resolvedConversations: resolvedChatsCount,
      resolutionRatePct,
      acrioLiveChatsCount,
      waitingNowCount,
      waitingP0Count,
      waitingP1Count,
      waitingP2Count,
      humanAssignmentsCount: humanAssignments.length,
      humanRespondedCount,
      humanResponseRatePct,
      avgHumanFirstResponseSeconds: computeAverage(humanResponseTimes),
      medianHumanFirstResponseSeconds: computeMedian(humanResponseTimes),
      fastestHumanFirstResponseSeconds:
        humanResponseTimes.length > 0 ? Math.min(...humanResponseTimes) : null,
      slowestHumanFirstResponseSeconds:
        humanResponseTimes.length > 0 ? Math.max(...humanResponseTimes) : null,
      slaUnder5MinPct,
      autoEscalationsCount,
      escalationRatePct,
      acrioAssignmentsCount: acrioAssignments.length,
      acrioAutonomousChats,
      acrioAutonomousRatePct,
      acrioAvgResponseSeconds: computeAverage(acrioRespTimes),
      aiTokensIn,
      aiTokensOut,
      aiTokensTotal,
      aiCacheReadTokens,
      aiLiveCallsCount,
      inboundMessagesCount,
      outboundMessagesCount,
      freeStaffRepliesCount,
      acrioRepliesCount,
      templateMessagesCount,
      internalNotesCount,
      outboundDeliveryRatePct,
      outboundReadRatePct,
      totalCustomers: customersRes.rows.length,
      optedInCustomers,
      optedOutCustomers,
      ordersCount: ordersRes.rows.length,
      ordersRevenueInr: Number(ordersRevenueInr.toFixed(2)),
      paidOrdersRevenueInr: Number(paidOrdersRevenueInr.toFixed(2)),
      ...(canViewBilling
        ? { clientBilledInr: Number(totalClientBilledInr.toFixed(2)) }
        : {}),
      ...(isDevPricing
        ? {
            actualMetaCostInr: Number(totalActualMetaCostInr.toFixed(4)),
            netMarginInr: Number(totalNetMarginInr.toFixed(4)),
          }
        : {}),
    },
    aiTokenSummary: {
      periodTokensIn: aiTokensIn,
      periodTokensOut: aiTokensOut,
      periodTokensTotal: aiTokensTotal,
      periodCacheReadTokens: aiCacheReadTokens,
      periodLiveAiCalls: aiLiveCallsCount,
      periodTotalTraces: aiLogsReport.entries.length,
      allTimeTokensIn: aiLogsReport.totalInputTokens,
      allTimeTokensOut: aiLogsReport.totalOutputTokens,
      allTimeTokensTotal: aiLogsReport.totalCombinedTokens,
      byWebsite: aiTokensByWebsite,
    },
    tickFunnel: {
      ...tickCounts,
      totalOutbound: outboundMessagesCount,
      deliveryRatePct: outboundDeliveryRatePct,
      readRatePct: outboundReadRatePct,
    },
    dailySeries,
    hourlyIst,
    agentLeaderboard,
    teamBreakdown,
    categories: Array.from(categoryCounts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count),
    priorities: Array.from(priorityCounts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count),
    segments: Array.from(segmentCounts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count),
    ...(canViewBilling ? { billingByCategory } : {}),
    broadcastSummary: {
      campaignsCount: broadcastsRes.rows.length,
      totalRecipients: bcTotalRecipients,
      sent: bcSent,
      delivered: bcDelivered,
      read: bcRead,
      skipped: bcSkipped,
      failed: bcFailed,
    },
    topTemplates: templatesRes.rows.slice(0, 6).map((tpl) => ({
      id: String(tpl.id),
      name: String(tpl.name),
      category: String(tpl.category),
      approvalStatus: String(tpl.approval_status),
      qualityScore: String(tpl.meta_quality_score || "GREEN"),
      sentCount: Number(tpl.sent_count ?? 0),
    })),
    topLinks: linksRes.rows.slice(0, 6).map((lnk) => ({
      id: String(lnk.id),
      code: String(lnk.code),
      title: String(lnk.title),
      targetUrl: String(lnk.target_url),
      linkType: String(lnk.link_type),
      clicksCount: Number(lnk.clicks_count ?? 0),
      lastClickedAt: lnk.last_clicked_at ? String(lnk.last_clicked_at) : null,
    })),
    assignmentLogs,
  };
}
