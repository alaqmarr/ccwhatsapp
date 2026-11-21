import { fromZonedTime } from "date-fns-tz";
import type { AuthenticatedUser } from "@cc/auth";
import { ensureDatabasesBootstrapped, getRawLibSqlClient } from "@cc/database";
import { canViewCostBreakdown, isDevRole } from "@cc/rbac";
import { rememberWhatsAppCache } from "@cc/storage";
import { buildBillingAndAiSummary } from "./billing-and-ai";
import { loadAnalyticsBusinessInsights } from "./business-insights";
import { buildConversationAndMessageMetrics } from "./conversations-metrics";
import {
  APP_TIMEZONE,
  computeMedian,
  resolveAnalyticsCutoff,
  toIstDateKey,
} from "./time-utils";

export async function loadAnalyticsPayload(
  user: AuthenticatedUser,
  opts?: {
    range?: string;
    teamId?: string;
    scope?: string | null;
    bypassCache?: boolean;
  }
) {
  await ensureDatabasesBootstrapped();

  const teamFilter = opts?.teamId || "ALL";
  const hasTeamFilter = teamFilter !== "ALL";
  const { range, cutoffIso, daysSpan, nowMs } = resolveAnalyticsCutoff(opts?.range);
  const requestedScope = opts?.scope ?? null;
  const canViewBilling = canViewCostBreakdown(user.role);
  const isDevPricing = isDevRole(user.role) && requestedScope === "dev";
  const pricingMode = isDevPricing
    ? "dev_actual_and_margin"
    : canViewBilling
    ? "client_set_pricing"
    : "hidden";

  const cacheKey = `analytics:${range}:${teamFilter}:${pricingMode}`;
  const compute = async () => {

  const chartDays = Math.min(daysSpan, 30);
  const chartStartKey = toIstDateKey(
    new Date(nowMs - (chartDays - 1) * 24 * 60 * 60 * 1000).toISOString()
  );
  const chartStartIso = fromZonedTime(
    `${chartStartKey} 00:00:00`,
    APP_TIMEZONE
  ).toISOString();
  const dailyMsgCutoff = cutoffIso > chartStartIso ? cutoffIso : chartStartIso;
  const dailyAssignCutoff = cutoffIso > chartStartIso ? cutoffIso : chartStartIso;

  const conv = getRawLibSqlClient("conversations");
  const contacts = getRawLibSqlClient("contacts");
  const crm = getRawLibSqlClient("crm_orders");
  const mkt = getRawLibSqlClient("marketing");
  const bill = getRawLibSqlClient("billing_ops");
  const auth = getRawLibSqlClient("core_auth");

  const convTeamWhere = hasTeamFilter ? "WHERE assigned_team_id = ?" : "";
  const convTeamAndPrefix = hasTeamFilter ? "assigned_team_id = ? AND " : "";
  const convTeamArgs = hasTeamFilter ? [teamFilter] : [];

  const msgTeamJoin = hasTeamFilter
    ? "INNER JOIN conversations c ON c.id = m.conversation_id"
    : "";
  const msgTeamAnd = hasTeamFilter ? " AND c.assigned_team_id = ?" : "";
  const msgTeamArgs = hasTeamFilter ? [teamFilter] : [];

  const assignTeamAnd = hasTeamFilter ? " AND to_team_id = ?" : "";
  const assignTeamArgs = hasTeamFilter ? [teamFilter] : [];

  const [
    convStatusRes,
    convCatPriRes,
    convDailyNewRes,
    convDailyResolvedRes,
    msgSummaryRes,
    msgDailyRes,
    msgHourlyRes,
    assignAggRes,
    assignDailyRes,
    assignRespRes,
    acrioAutonRes,
    assignmentLogsRes,
    teamAssignAggRes,
    teamConvAggRes,
    teamsRes,
    linksRes,
    customersAggRes,
    ordersAggRes,
    templatesRes,
    broadcastsAggRes,
    ledgerAggRes,
    pricingCfgRes,
    usersRes,
    businessInsights,
  ] = await Promise.all([
    conv.execute({
      sql: `SELECT COALESCE(NULLIF(status, ''), 'OPEN') AS status,
                   COALESCE(NULLIF(assigned_staff_id, ''), 'ACRIO') AS staff_id,
                   COALESCE(NULLIF(escalation_level, ''), 'P0') AS esc_level,
                   CASE WHEN waiting_since IS NOT NULL AND waiting_since != '' THEN 1 ELSE 0 END AS is_waiting,
                   COALESCE(resolved_by_id, '') AS resolved_by_id,
                   COALESCE(resolved_by_name, '') AS resolved_by_name,
                   COUNT(*) AS cnt
            FROM conversations
            ${convTeamWhere}
            GROUP BY status, staff_id, esc_level, is_waiting, resolved_by_id, resolved_by_name`,
      args: convTeamArgs,
    }),
    conv.execute({
      sql: `SELECT COALESCE(NULLIF(smart_category, ''), 'General Enquiry') AS category,
                   COALESCE(NULLIF(priority, ''), 'NORMAL') AS priority,
                   COUNT(*) AS cnt
            FROM conversations
            WHERE ${convTeamAndPrefix}(COALESCE(NULLIF(last_message_at, ''), created_at) >= ? OR created_at >= ?)
            GROUP BY category, priority`,
      args: [...convTeamArgs, cutoffIso, cutoffIso],
    }),
    conv.execute({
      sql: `SELECT strftime('%Y-%m-%d', created_at, '+330 minutes') AS ist_day,
                   COUNT(*) AS cnt
            FROM conversations
            WHERE ${convTeamAndPrefix}created_at >= ?
            GROUP BY ist_day`,
      args: [...convTeamArgs, chartStartIso],
    }),
    conv.execute({
      sql: `SELECT strftime('%Y-%m-%d', resolved_at, '+330 minutes') AS ist_day,
                   COUNT(*) AS cnt
            FROM conversations
            WHERE ${convTeamAndPrefix}resolved_at IS NOT NULL AND resolved_at != '' AND resolved_at >= ?
            GROUP BY ist_day`,
      args: [...convTeamArgs, chartStartIso],
    }),
    conv.execute({
      sql: `SELECT m.direction,
                   m.message_type,
                   m.billing_category,
                   UPPER(COALESCE(NULLIF(m.delivery_status, ''), 'SENT')) AS d_stat,
                   COALESCE(m.sender_staff_id, '') AS sender_staff_id,
                   COALESCE(m.sender_name, '') AS sender_name,
                   COUNT(*) AS cnt
            FROM messages m
            ${msgTeamJoin}
            WHERE m.created_at >= ?${msgTeamAnd}
            GROUP BY m.direction, m.message_type, m.billing_category, d_stat, m.sender_staff_id, m.sender_name`,
      args: [cutoffIso, ...msgTeamArgs],
    }),
    conv.execute({
      sql: `SELECT strftime('%Y-%m-%d', m.created_at, '+330 minutes') AS ist_day,
                   m.direction,
                   COUNT(*) AS cnt
            FROM messages m
            ${msgTeamJoin}
            WHERE m.created_at >= ? AND m.direction IN ('INBOUND', 'OUTBOUND')${msgTeamAnd}
            GROUP BY ist_day, m.direction`,
      args: [dailyMsgCutoff, ...msgTeamArgs],
    }),
    conv.execute({
      sql: `SELECT CAST(strftime('%H', m.created_at, '+330 minutes') AS INTEGER) AS ist_hour,
                   m.direction,
                   COUNT(*) AS cnt
            FROM messages m
            ${msgTeamJoin}
            WHERE m.created_at >= ? AND m.direction IN ('INBOUND', 'OUTBOUND')${msgTeamAnd}
            GROUP BY ist_hour, m.direction`,
      args: [cutoffIso, ...msgTeamArgs],
    }),
    conv.execute({
      sql: `SELECT COALESCE(to_staff_id, '') AS to_staff_id,
                   COALESCE(to_staff_name, '') AS to_staff_name,
                   COALESCE(to_team_name, '') AS to_team_name,
                   COALESCE(assignment_source, '') AS assignment_source,
                   COALESCE(outcome, '') AS outcome,
                   COUNT(*) AS cnt,
                   SUM(CASE WHEN first_response_at IS NOT NULL AND first_response_at != '' AND first_response_seconds IS NOT NULL THEN 1 ELSE 0 END) AS responded_cnt,
                   SUM(CASE WHEN first_response_at IS NOT NULL AND first_response_at != '' AND first_response_seconds IS NOT NULL AND first_response_seconds <= 300 THEN 1 ELSE 0 END) AS under_5min_cnt,
                   COALESCE(SUM(CASE WHEN first_response_at IS NOT NULL AND first_response_at != '' AND first_response_seconds IS NOT NULL THEN first_response_seconds ELSE 0 END), 0) AS sum_resp_sec,
                   MIN(CASE WHEN first_response_at IS NOT NULL AND first_response_at != '' AND first_response_seconds IS NOT NULL THEN first_response_seconds ELSE NULL END) AS min_resp_sec,
                   MAX(CASE WHEN first_response_at IS NOT NULL AND first_response_at != '' AND first_response_seconds IS NOT NULL THEN first_response_seconds ELSE NULL END) AS max_resp_sec
            FROM conversation_assignments
            WHERE assigned_at >= ?${assignTeamAnd}
            GROUP BY to_staff_id, to_staff_name, to_team_name, assignment_source, outcome`,
      args: [cutoffIso, ...assignTeamArgs],
    }),
    conv.execute({
      sql: `SELECT strftime('%Y-%m-%d', assigned_at, '+330 minutes') AS ist_day,
                   COUNT(*) AS cnt,
                   AVG(CASE WHEN first_response_at IS NOT NULL AND first_response_at != '' AND first_response_seconds IS NOT NULL THEN first_response_seconds ELSE NULL END) AS avg_resp_sec
            FROM conversation_assignments
            WHERE assigned_at >= ? AND COALESCE(to_staff_id, '') != 'ACRIO'${assignTeamAnd}
            GROUP BY ist_day`,
      args: [dailyAssignCutoff, ...assignTeamArgs],
    }),
    conv.execute({
      sql: `SELECT COALESCE(to_staff_id, '') AS to_staff_id,
                   COALESCE(to_staff_name, '') AS to_staff_name,
                   first_response_seconds
            FROM conversation_assignments
            WHERE assigned_at >= ?${assignTeamAnd}
              AND first_response_at IS NOT NULL AND first_response_at != '' AND first_response_seconds IS NOT NULL`,
      args: [cutoffIso, ...assignTeamArgs],
    }),
    conv.execute({
      sql: `SELECT COALESCE(SUM(has_acrio), 0) AS acrio_convs,
                   COALESCE(SUM(CASE WHEN has_acrio = 1 AND has_human = 0 THEN 1 ELSE 0 END), 0) AS autonomous_convs
            FROM (
              SELECT conversation_id,
                     MAX(CASE WHEN COALESCE(to_staff_id, '') = 'ACRIO' THEN 1 ELSE 0 END) AS has_acrio,
                     MAX(CASE WHEN COALESCE(to_staff_id, '') != 'ACRIO' THEN 1 ELSE 0 END) AS has_human
              FROM conversation_assignments
              WHERE assigned_at >= ?${assignTeamAnd}
              GROUP BY conversation_id
            )`,
      args: [cutoffIso, ...assignTeamArgs],
    }),
    conv.execute({
      sql: `SELECT id, conversation_id, customer_phone, customer_name, from_staff_name,
                   from_team_name, to_staff_id, to_staff_name, to_team_id, to_team_name,
                   escalation_level, assignment_source, assigned_by_name, reason,
                   assigned_at, first_response_at, first_response_seconds, ended_at, outcome
            FROM conversation_assignments
            WHERE assigned_at >= ?${assignTeamAnd}
            ORDER BY assigned_at DESC
            LIMIT 120`,
      args: [cutoffIso, ...assignTeamArgs],
    }),
    conv.execute({
      sql: `SELECT to_team_id AS team_id,
                   COUNT(*) AS assignments_cnt,
                   SUM(CASE WHEN first_response_at IS NOT NULL AND first_response_at != '' AND first_response_seconds IS NOT NULL THEN 1 ELSE 0 END) AS responded_cnt,
                   AVG(CASE WHEN first_response_at IS NOT NULL AND first_response_at != '' AND first_response_seconds IS NOT NULL THEN first_response_seconds ELSE NULL END) AS avg_resp_sec,
                   SUM(CASE WHEN COALESCE(NULLIF(escalation_level, ''), 'P0') = 'P2' THEN 1 ELSE 0 END) AS p2_cnt,
                   SUM(CASE WHEN COALESCE(NULLIF(escalation_level, ''), 'P0') = 'P1' THEN 1 ELSE 0 END) AS p1_cnt,
                   SUM(CASE WHEN COALESCE(NULLIF(escalation_level, ''), 'P0') NOT IN ('P1', 'P2') THEN 1 ELSE 0 END) AS p0_cnt,
                   SUM(CASE WHEN outcome = 'ESCALATED' THEN 1 ELSE 0 END) AS escalated_cnt
            FROM conversation_assignments
            WHERE assigned_at >= ? AND to_team_id IS NOT NULL AND to_team_id != ''
            GROUP BY to_team_id`,
      args: [cutoffIso],
    }),
    conv.execute(
      `SELECT assigned_team_id AS team_id,
              COUNT(*) AS open_cnt,
              SUM(CASE WHEN waiting_since IS NOT NULL AND waiting_since != '' THEN 1 ELSE 0 END) AS waiting_cnt
       FROM conversations
       WHERE status != 'RESOLVED' AND assigned_team_id IS NOT NULL AND assigned_team_id != ''
       GROUP BY assigned_team_id`
    ),
    conv.execute(
      `SELECT id, name, brand_scope, p0_wait_minutes, p1_wait_minutes
       FROM teams
       ORDER BY priority_rank ASC, name ASC`
    ),
    conv.execute(
      `SELECT id, code, title, target_url, link_type, clicks_count, last_clicked_at
       FROM custom_links
       ORDER BY clicks_count DESC, created_at DESC
       LIMIT 6`
    ),
    crm.execute(
      `SELECT COALESCE(NULLIF(organization_type, ''), 'Business') AS seg,
              CASE WHEN COALESCE(opt_in_marketing, 1) = 1 THEN 1 ELSE 0 END AS opted_in,
              COUNT(*) AS cnt
       FROM customers
       GROUP BY seg, opted_in`
    ),
    crm.execute({
      sql: `SELECT COUNT(*) AS orders_cnt,
                   COALESCE(SUM(COALESCE(total_amount_inr, 0)), 0) AS orders_rev,
                   COALESCE(SUM(CASE WHEN payment_status IN ('PAID', 'ADVANCE_PAID') THEN COALESCE(total_amount_inr, 0) ELSE 0 END), 0) AS paid_rev
            FROM customer_orders
            WHERE ordered_at >= ?`,
      args: [cutoffIso],
    }),
    mkt.execute(
      `SELECT id, name, category, approval_status, meta_quality_score, sent_count
       FROM templates
       ORDER BY sent_count DESC, name ASC
       LIMIT 6`
    ),
    mkt.execute({
      sql: `SELECT COUNT(*) AS campaigns_count,
                   COALESCE(SUM(COALESCE(total_recipients, 0)), 0) AS total_recipients,
                   COALESCE(SUM(COALESCE(sent_count, 0)), 0) AS sent_count,
                   COALESCE(SUM(COALESCE(delivered_count, 0)), 0) AS delivered_count,
                   COALESCE(SUM(COALESCE(read_count, 0)), 0) AS read_count,
                   COALESCE(SUM(COALESCE(skipped_count, 0)), 0) AS skipped_count,
                   COALESCE(SUM(COALESCE(failed_count, 0)), 0) AS failed_count
            FROM broadcasts
            WHERE created_at >= ?`,
      args: [cutoffIso],
    }),
    bill.execute({
      sql: `SELECT UPPER(COALESCE(NULLIF(category, ''), 'UTILITY')) AS category,
                   COUNT(*) AS row_count,
                   COALESCE(SUM(COALESCE(client_unit_rate_inr, 0)), 0) AS client_billed_sum
            FROM message_billing_ledger
            WHERE billed_at >= ?
            GROUP BY UPPER(COALESCE(NULLIF(category, ''), 'UTILITY'))`,
      args: [cutoffIso],
    }),
    bill.execute(`SELECT * FROM pricing_config WHERE id = 'default' LIMIT 1`),
    auth.execute(
      `SELECT id, name, role, department
       FROM users
       WHERE status = 'ACTIVE' AND role != 'CLIENT'
       ORDER BY name ASC`
    ),
    loadAnalyticsBusinessInsights({
      conv,
      contacts,
      cutoffIso,
      nowMs,
      hasTeamFilter,
      teamFilter,
    }),
  ]);

  const metrics = buildConversationAndMessageMetrics({
    convStatusRows: convStatusRes.rows as Record<string, unknown>[],
    convCatPriRows: convCatPriRes.rows as Record<string, unknown>[],
    convDailyNewRows: convDailyNewRes.rows as Record<string, unknown>[],
    convDailyResolvedRows: convDailyResolvedRes.rows as Record<string, unknown>[],
    msgSummaryRows: msgSummaryRes.rows as Record<string, unknown>[],
    msgDailyRows: msgDailyRes.rows as Record<string, unknown>[],
    msgHourlyRows: msgHourlyRes.rows as Record<string, unknown>[],
    assignAggRows: assignAggRes.rows as Record<string, unknown>[],
    assignDailyRows: assignDailyRes.rows as Record<string, unknown>[],
    assignRespRows: assignRespRes.rows as Record<string, unknown>[],
    acrioAutonRow: (acrioAutonRes.rows[0] || {}) as Record<string, unknown>,
    teamAssignAggRows: teamAssignAggRes.rows as Record<string, unknown>[],
    teamConvAggRows: teamConvAggRes.rows as Record<string, unknown>[],
    teamRows: teamsRes.rows as Record<string, unknown>[],
    userRows: usersRes.rows as Record<string, unknown>[],
    daysSpan,
    nowMs,
  });

  let totalCustomers = 0;
  let optedInCustomers = 0;
  let optedOutCustomers = 0;
  const segmentCounts = new Map<string, number>();
  for (const c of customersAggRes.rows) {
    const cnt = Number(c.cnt ?? 0);
    totalCustomers += cnt;
    if (Number(c.opted_in ?? 1) === 1) optedInCustomers += cnt;
    else optedOutCustomers += cnt;
    const seg = String(c.seg || "Business");
    segmentCounts.set(seg, (segmentCounts.get(seg) || 0) + cnt);
  }

  const orderAgg = (ordersAggRes.rows[0] || {}) as Record<string, unknown>;
  const ordersCount = Number(orderAgg.orders_cnt ?? 0);
  const ordersRevenueInr = Number(orderAgg.orders_rev ?? 0);
  const paidOrdersRevenueInr = Number(orderAgg.paid_rev ?? 0);

  const bcAgg = (broadcastsAggRes.rows[0] || {}) as Record<string, unknown>;

  const billing = buildBillingAndAiSummary({
    ledgerAggRows: ledgerAggRes.rows as Record<string, unknown>[],
    pricingCfg: (pricingCfgRes.rows[0] || {}) as Record<string, unknown>,
    freeStaffRepliesCount: metrics.freeStaffRepliesCount,
    isDevPricing,
    cutoffIso,
  });

  const totalConvsCount = metrics.totalConvsCount;
  const resolutionRatePct =
    totalConvsCount > 0
      ? Math.round((metrics.resolvedChatsCount / totalConvsCount) * 100)
      : 0;
  const humanResponseRatePct =
    metrics.humanAssignmentsCount > 0
      ? Math.round((metrics.humanRespondedCount / metrics.humanAssignmentsCount) * 100)
      : 0;
  const slaUnder5MinPct =
    metrics.humanRespondedCount > 0
      ? Math.round((metrics.humanUnder5MinCount / metrics.humanRespondedCount) * 100)
      : 100;
  const escalationRatePct =
    metrics.humanAssignmentsCount > 0
      ? Math.round((metrics.autoEscalationsCount / metrics.humanAssignmentsCount) * 100)
      : 0;
  const acrioAutonomousRatePct =
    metrics.convsWithAcrioAsgCount > 0
      ? Math.round(
          (metrics.acrioAutonomousChats / metrics.convsWithAcrioAsgCount) * 100
        )
      : 0;

  const deliveredOrReadCount = metrics.tickCounts.delivered + metrics.tickCounts.read;
  const outboundDeliveryRatePct =
    metrics.outboundMessagesCount > 0
      ? Math.round((deliveredOrReadCount / metrics.outboundMessagesCount) * 100)
      : 0;
  const outboundReadRatePct =
    metrics.outboundMessagesCount > 0
      ? Math.round((metrics.tickCounts.read / metrics.outboundMessagesCount) * 100)
      : 0;

  const assignmentLogs = assignmentLogsRes.rows.map((a) => ({
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
      openConversations: metrics.openChatsCount,
      assignedConversations: metrics.assignedChatsCount,
      resolvedConversations: metrics.resolvedChatsCount,
      resolutionRatePct,
      acrioLiveChatsCount: metrics.acrioLiveChatsCount,
      waitingNowCount: metrics.waitingNowCount,
      waitingP0Count: metrics.waitingP0Count,
      waitingP1Count: metrics.waitingP1Count,
      waitingP2Count: metrics.waitingP2Count,
      humanAssignmentsCount: metrics.humanAssignmentsCount,
      humanRespondedCount: metrics.humanRespondedCount,
      humanResponseRatePct,
      avgHumanFirstResponseSeconds: metrics.avgHumanFirstResponseSeconds,
      medianHumanFirstResponseSeconds: computeMedian(metrics.humanResponseTimes),
      fastestHumanFirstResponseSeconds: metrics.humanMinRespSec,
      slowestHumanFirstResponseSeconds: metrics.humanMaxRespSec,
      slaUnder5MinPct,
      autoEscalationsCount: metrics.autoEscalationsCount,
      escalationRatePct,
      acrioAssignmentsCount: metrics.acrioAssignmentsCount,
      acrioAutonomousChats: metrics.acrioAutonomousChats,
      acrioAutonomousRatePct,
      acrioAvgResponseSeconds: metrics.acrioAvgResponseSeconds,
      aiTokensIn: billing.aiTokensIn,
      aiTokensOut: billing.aiTokensOut,
      aiTokensTotal: billing.aiTokensTotal,
      aiCacheReadTokens: billing.aiCacheReadTokens,
      aiLiveCallsCount: billing.aiLiveCallsCount,
      inboundMessagesCount: metrics.inboundMessagesCount,
      outboundMessagesCount: metrics.outboundMessagesCount,
      freeStaffRepliesCount: metrics.freeStaffRepliesCount,
      acrioRepliesCount: metrics.acrioRepliesCount,
      templateMessagesCount: metrics.templateMessagesCount,
      internalNotesCount: metrics.internalNotesCount,
      outboundDeliveryRatePct,
      outboundReadRatePct,
      totalCustomers,
      optedInCustomers,
      optedOutCustomers,
      ordersCount,
      ordersRevenueInr: Number(ordersRevenueInr.toFixed(2)),
      paidOrdersRevenueInr: Number(paidOrdersRevenueInr.toFixed(2)),
      ...(canViewBilling
        ? { clientBilledInr: Number(billing.totalClientBilledInr.toFixed(2)) }
        : {}),
      ...(isDevPricing
        ? {
            metaWholesaleBaseInr: Number(billing.totalPeriodMetaBaseInr.toFixed(2)),
            metaWholesaleGstInr: billing.periodMetaGstInr,
            metaWholesaleWithGstInr: billing.periodMetaWithGstInr,
            whatsappAiCostWithGstInr: billing.periodAiCosts.whatsappHub.totalWithGstInr,
            ecosystemAiCostWithGstInr: billing.periodAiCosts.allEcosystem.totalWithGstInr,
            actualMetaCostInr: billing.periodCombinedCostWithGstInr,
            netMarginInr: billing.periodNetProfitWithGstInr,
          }
        : {}),
    },
    aiTokenSummary: {
      periodTokensIn: billing.aiTokensIn,
      periodTokensOut: billing.aiTokensOut,
      periodTokensTotal: billing.aiTokensTotal,
      periodCacheReadTokens: billing.aiCacheReadTokens,
      periodCacheWriteTokens: billing.aiCacheWriteTokens,
      periodLiveAiCalls: billing.aiLiveCallsCount,
      periodTotalTraces: billing.aiLogsReport.entries.length,
      ...(isDevPricing ? { periodAiCosts: billing.periodAiCosts } : {}),
      allTimeTokensIn: billing.aiLogsReport.totalInputTokens,
      allTimeTokensOut: billing.aiLogsReport.totalOutputTokens,
      allTimeTokensTotal: billing.aiLogsReport.totalCombinedTokens,
      byWebsite: billing.aiTokensByWebsite,
    },
    tickFunnel: {
      ...metrics.tickCounts,
      totalOutbound: metrics.outboundMessagesCount,
      deliveryRatePct: outboundDeliveryRatePct,
      readRatePct: outboundReadRatePct,
    },
    dailySeries: metrics.dailySeries,
    hourlyIst: metrics.hourlyIst,
    agentLeaderboard: metrics.agentLeaderboard,
    teamBreakdown: metrics.teamBreakdown,
    categories: Array.from(metrics.categoryCounts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count),
    priorities: Array.from(metrics.priorityCounts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count),
    segments: Array.from(segmentCounts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count),
    ...(canViewBilling ? { billingByCategory: billing.billingByCategory } : {}),
    broadcastSummary: {
      campaignsCount: Number(bcAgg.campaigns_count ?? 0),
      totalRecipients: Number(bcAgg.total_recipients ?? 0),
      sent: Number(bcAgg.sent_count ?? 0),
      delivered: Number(bcAgg.delivered_count ?? 0),
      read: Number(bcAgg.read_count ?? 0),
      skipped: Number(bcAgg.skipped_count ?? 0),
      failed: Number(bcAgg.failed_count ?? 0),
    },
    topTemplates: templatesRes.rows.map((tpl) => ({
      id: String(tpl.id),
      name: String(tpl.name),
      category: String(tpl.category),
      approvalStatus: String(tpl.approval_status),
      qualityScore: String(tpl.meta_quality_score || "GREEN"),
      sentCount: Number(tpl.sent_count ?? 0),
    })),
    topLinks: linksRes.rows.map((lnk) => ({
      id: String(lnk.id),
      code: String(lnk.code),
      title: String(lnk.title),
      targetUrl: String(lnk.target_url),
      linkType: String(lnk.link_type),
      clicksCount: Number(lnk.clicks_count ?? 0),
      lastClickedAt: lnk.last_clicked_at ? String(lnk.last_clicked_at) : null,
    })),
    assignmentLogs,
    businessInsights,
  };
  };

  if (opts?.bypassCache) {
    return compute();
  }
  return rememberWhatsAppCache(cacheKey, ["customer-history"], 20, compute, {
    skipClone: true,
  });
}
