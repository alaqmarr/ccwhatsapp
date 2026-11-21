import type { Client } from "@libsql/client";
import { formatHourLabel } from "./time-utils";

export interface TemplateInsightItem {
  templateName: string;
  sentCount: number;
  deliveredCount: number;
  readCount: number;
  failedCount: number;
  err131049Count: number;
  repliedCount: number;
  readRatePct: number;
  replyRatePct: number;
}

export interface LeadSourceInsightItem {
  source: string;
  label: string;
  totalContacts: number;
  optedInCount: number;
  convertedCount: number;
  conversionRatePct: number;
  lifetimeValueInr: number;
}

export interface ExpiringWindowChatItem {
  conversationId: string;
  customerName: string;
  customerPhone: string;
  assignedStaffName: string;
  minutesRemaining: number;
  windowExpiresAt: string;
}

export interface StaleHotLeadItem {
  contactId: string;
  name: string;
  phone: string;
  stage: string;
  preferredStaffName: string;
  conversationId: string | null;
  lastContactedAt: string | null;
}

export interface SlaBreachHourItem {
  hour: number;
  label: string;
  assignmentsCount: number;
  over5MinCount: number;
  breachRatePct: number;
}

export interface BusinessInsightsPayload {
  templateInsights: TemplateInsightItem[];
  leadSourceBreakdown: LeadSourceInsightItem[];
  followUpInsights: {
    expiringWindowCount: number;
    expiringWindowChats: ExpiringWindowChatItem[];
    missingPreferredStaffCount: number;
    staleHotLeadsCount: number;
    staleHotLeads: StaleHotLeadItem[];
  };
  slaBreachHoursIst: SlaBreachHourItem[];
}

function formatContactSourceLabel(src: string): string {
  switch (src.toUpperCase()) {
    case "WHATSAPP_INBOUND":
      return "WhatsApp Inbound";
    case "WEBSITE_ENQUIRY":
      return "Website Enquiry";
    case "CSV_IMPORT":
      return "CSV / Legacy CRM Import";
    case "MANUAL":
      return "Manual Entry";
    case "CRM_ORDERS":
      return "Orders Sync";
    default:
      return src || "Other";
  }
}

export async function loadAnalyticsBusinessInsights(params: {
  conv: Client;
  contacts: Client;
  cutoffIso: string;
  nowMs: number;
  hasTeamFilter: boolean;
  teamFilter: string;
}): Promise<BusinessInsightsPayload> {
  const { conv, contacts, cutoffIso, nowMs, hasTeamFilter, teamFilter } = params;
  const nowIso = new Date(nowMs).toISOString();
  const plus2hIso = new Date(nowMs + 2 * 60 * 60 * 1000).toISOString();
  const staleCutoffIso = new Date(nowMs - 3 * 24 * 60 * 60 * 1000).toISOString();

  const teamConvClause = hasTeamFilter ? " AND c.assigned_team_id = ?" : "";
  const teamConvPlain = hasTeamFilter ? " AND assigned_team_id = ?" : "";
  const teamAssignClause = hasTeamFilter ? " AND to_team_id = ?" : "";
  const teamArgs = hasTeamFilter ? [teamFilter] : [];

  const [
    tplPerfRes,
    leadSrcRes,
    prefMissingRes,
    staleCntRes,
    staleRowsRes,
    expiringCntRes,
    expiringRowsRes,
    slaHoursRes,
  ] = await Promise.all([
    conv.execute({
      sql: `SELECT m.template_name,
                   COUNT(*) AS sent_cnt,
                   SUM(CASE WHEN UPPER(COALESCE(m.delivery_status, '')) IN ('DELIVERED', 'READ') THEN 1 ELSE 0 END) AS delivered_cnt,
                   SUM(CASE WHEN UPPER(COALESCE(m.delivery_status, '')) = 'READ' THEN 1 ELSE 0 END) AS read_cnt,
                   SUM(CASE WHEN UPPER(COALESCE(m.delivery_status, '')) = 'FAILED' THEN 1 ELSE 0 END) AS failed_cnt,
                   SUM(CASE WHEN COALESCE(m.metadata_json, '') LIKE '%131049%' THEN 1 ELSE 0 END) AS err_131049_cnt,
                   SUM(CASE WHEN EXISTS (
                     SELECT 1 FROM messages r
                     WHERE r.conversation_id = m.conversation_id
                       AND r.direction = 'INBOUND'
                       AND r.created_at > m.created_at
                   ) THEN 1 ELSE 0 END) AS replied_cnt
            FROM messages m
            ${hasTeamFilter ? "INNER JOIN conversations c ON c.id = m.conversation_id" : ""}
            WHERE m.direction = 'OUTBOUND'
              AND m.template_name IS NOT NULL
              AND m.template_name != ''
              AND m.created_at >= ?${teamConvClause}
            GROUP BY m.template_name
            ORDER BY sent_cnt DESC
            LIMIT 8`,
      args: [cutoffIso, ...teamArgs],
    }),
    contacts.execute(
      `SELECT UPPER(COALESCE(NULLIF(source, ''), 'MANUAL')) AS src,
              COUNT(*) AS total_cnt,
              SUM(CASE WHEN COALESCE(opt_in_marketing, 1) = 1 THEN 1 ELSE 0 END) AS opted_in_cnt,
              SUM(CASE WHEN COALESCE(total_orders_count, 0) > 0 OR stage IN ('CUSTOMER', 'REPEAT_BUYER', 'VIP') THEN 1 ELSE 0 END) AS converted_cnt,
              COALESCE(SUM(COALESCE(lifetime_value_inr, 0)), 0) AS ltv_sum
       FROM contacts
       GROUP BY UPPER(COALESCE(NULLIF(source, ''), 'MANUAL'))
       ORDER BY total_cnt DESC`
    ),
    contacts.execute(
      `SELECT COUNT(*) AS cnt
       FROM contacts
       WHERE preferred_staff_id IS NULL OR TRIM(preferred_staff_id) = ''`
    ),
    contacts.execute({
      sql: `SELECT COUNT(*) AS cnt
            FROM contacts
            WHERE stage IN ('NEW_LEAD', 'QUALIFIED', 'NEGOTIATION', 'QUOTED')
              AND COALESCE(NULLIF(last_contacted_at, ''), updated_at) <= ?`,
      args: [staleCutoffIso],
    }),
    contacts.execute({
      sql: `SELECT id, name, phone, stage, COALESCE(preferred_staff_name, '') AS preferred_staff_name, last_contacted_at, updated_at
            FROM contacts
            WHERE stage IN ('NEW_LEAD', 'QUALIFIED', 'NEGOTIATION', 'QUOTED')
              AND COALESCE(NULLIF(last_contacted_at, ''), updated_at) <= ?
            ORDER BY COALESCE(NULLIF(last_contacted_at, ''), updated_at) ASC
            LIMIT 6`,
      args: [staleCutoffIso],
    }),
    conv.execute({
      sql: `SELECT COUNT(*) AS cnt
            FROM conversations
            WHERE status != 'RESOLVED'
              AND window_expires_at IS NOT NULL
              AND window_expires_at > ?
              AND window_expires_at <= ?${teamConvPlain}`,
      args: [nowIso, plus2hIso, ...teamArgs],
    }),
    conv.execute({
      sql: `SELECT id, customer_name, customer_phone, COALESCE(assigned_staff_name, 'Unassigned') AS assigned_staff_name, window_expires_at
            FROM conversations
            WHERE status != 'RESOLVED'
              AND window_expires_at IS NOT NULL
              AND window_expires_at > ?
              AND window_expires_at <= ?${teamConvPlain}
            ORDER BY window_expires_at ASC
            LIMIT 6`,
      args: [nowIso, plus2hIso, ...teamArgs],
    }),
    conv.execute({
      sql: `SELECT CAST(strftime('%H', assigned_at, '+330 minutes') AS INTEGER) AS ist_hour,
                   COUNT(*) AS total_cnt,
                   SUM(CASE WHEN first_response_at IS NULL OR first_response_at = '' OR COALESCE(first_response_seconds, 0) > 300 THEN 1 ELSE 0 END) AS over_5min_cnt
            FROM conversation_assignments
            WHERE assigned_at >= ?
              AND COALESCE(to_staff_id, '') != 'ACRIO'${teamAssignClause}
            GROUP BY ist_hour
            ORDER BY over_5min_cnt DESC, total_cnt DESC
            LIMIT 6`,
      args: [cutoffIso, ...teamArgs],
    }),
  ]);

  const templateInsights: TemplateInsightItem[] = tplPerfRes.rows.map((r) => {
    const sentCount = Number(r.sent_cnt ?? 0);
    const deliveredCount = Number(r.delivered_cnt ?? 0);
    const readCount = Number(r.read_cnt ?? 0);
    const failedCount = Number(r.failed_cnt ?? 0);
    const err131049Count = Number(r.err_131049_cnt ?? 0);
    const repliedCount = Number(r.replied_cnt ?? 0);
    return {
      templateName: String(r.template_name || ""),
      sentCount,
      deliveredCount,
      readCount,
      failedCount,
      err131049Count,
      repliedCount,
      readRatePct: sentCount > 0 ? Math.round((readCount / sentCount) * 100) : 0,
      replyRatePct: sentCount > 0 ? Math.round((repliedCount / sentCount) * 100) : 0,
    };
  });

  const leadSourceBreakdown: LeadSourceInsightItem[] = leadSrcRes.rows.map((r) => {
    const src = String(r.src || "MANUAL");
    const totalContacts = Number(r.total_cnt ?? 0);
    const convertedCount = Number(r.converted_cnt ?? 0);
    return {
      source: src,
      label: formatContactSourceLabel(src),
      totalContacts,
      optedInCount: Number(r.opted_in_cnt ?? 0),
      convertedCount,
      conversionRatePct:
        totalContacts > 0 ? Math.round((convertedCount / totalContacts) * 100) : 0,
      lifetimeValueInr: Number(Number(r.ltv_sum ?? 0).toFixed(2)),
    };
  });

  const expiringWindowChats: ExpiringWindowChatItem[] = expiringRowsRes.rows.map((r) => {
    const expIso = String(r.window_expires_at || "");
    const expMs = new Date(expIso).getTime();
    const mins = Number.isFinite(expMs)
      ? Math.max(1, Math.round((expMs - nowMs) / 60000))
      : 0;
    return {
      conversationId: String(r.id),
      customerName: String(r.customer_name || r.customer_phone || "Customer"),
      customerPhone: String(r.customer_phone || ""),
      assignedStaffName: String(r.assigned_staff_name || "Unassigned"),
      minutesRemaining: mins,
      windowExpiresAt: expIso,
    };
  });

  const stalePhones = staleRowsRes.rows
    .map((r) => String(r.phone || "").trim())
    .filter(Boolean);
  const convIdByPhone = new Map<string, string>();
  if (stalePhones.length > 0) {
    const placeholders = stalePhones.map(() => "?").join(",");
    const convMatch = await conv.execute({
      sql: `SELECT id, customer_phone FROM conversations WHERE customer_phone IN (${placeholders})`,
      args: stalePhones,
    });
    for (const c of convMatch.rows) {
      convIdByPhone.set(String(c.customer_phone), String(c.id));
    }
  }

  const staleHotLeads: StaleHotLeadItem[] = staleRowsRes.rows.map((r) => {
    const phone = String(r.phone || "");
    return {
      contactId: String(r.id),
      name: String(r.name || phone || "Contact"),
      phone,
      stage: String(r.stage || "NEW_LEAD"),
      preferredStaffName: String(r.preferred_staff_name || ""),
      conversationId: convIdByPhone.get(phone) || null,
      lastContactedAt: r.last_contacted_at
        ? String(r.last_contacted_at)
        : r.updated_at
        ? String(r.updated_at)
        : null,
    };
  });

  const slaBreachHoursIst: SlaBreachHourItem[] = slaHoursRes.rows
    .map((r) => {
      const hr = Number(r.ist_hour ?? 0);
      const assignmentsCount = Number(r.total_cnt ?? 0);
      const over5MinCount = Number(r.over_5min_cnt ?? 0);
      return {
        hour: hr,
        label: formatHourLabel(hr),
        assignmentsCount,
        over5MinCount,
        breachRatePct:
          assignmentsCount > 0 ? Math.round((over5MinCount / assignmentsCount) * 100) : 0,
      };
    })
    .filter((h) => h.hour >= 0 && h.hour <= 23 && h.over5MinCount > 0);

  return {
    templateInsights,
    leadSourceBreakdown,
    followUpInsights: {
      expiringWindowCount: Number(expiringCntRes.rows[0]?.cnt ?? 0),
      expiringWindowChats,
      missingPreferredStaffCount: Number(prefMissingRes.rows[0]?.cnt ?? 0),
      staleHotLeadsCount: Number(staleCntRes.rows[0]?.cnt ?? 0),
      staleHotLeads,
    },
    slaBreachHoursIst,
  };
}
