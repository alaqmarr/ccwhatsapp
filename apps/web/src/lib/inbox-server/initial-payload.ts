import {
  ensureDatabasesBootstrapped,
  getRawLibSqlClient,
  parseConversationCollaborators,
} from "@cc/database";
import { canAssignToDev, type UserRole } from "@cc/rbac";
import { ensureBackgroundWorkersRunning } from "@cc/workers";
import { getConversationDetailServer } from "./detail";
import {
  pickInitialConversationId,
  type InboxQuickFilter,
} from "../inbox-filter-helpers";
import type {
  ApprovedTemplateOption,
  ConversationSummary,
  InitialInboxPayload,
  QuickReplyItem,
  StaffOption,
  TeamOption,
  TemplateVariableSpecOption,
} from "./types";

async function fetchMissingLastMessageFallback(
  conv: ReturnType<typeof getRawLibSqlClient>,
  missingIds: string[]
): Promise<Map<string, { direction: string; status: string }>> {
  const fallbackMap = new Map<string, { direction: string; status: string }>();
  if (missingIds.length === 0) return fallbackMap;

  const placeholders = missingIds.map(() => "?").join(",");
  const res = await conv.execute({
    sql: `SELECT conversation_id, direction, delivery_status
          FROM (
            SELECT conversation_id, direction, delivery_status,
                   ROW_NUMBER() OVER (PARTITION BY conversation_id ORDER BY created_at DESC, rowid DESC) AS rn
            FROM messages
            WHERE conversation_id IN (${placeholders})
              AND direction IN ('INBOUND', 'OUTBOUND')
          )
          WHERE rn = 1`,
    args: missingIds,
  });

  for (const row of res.rows) {
    fallbackMap.set(String(row.conversation_id), {
      direction: String(row.direction),
      status: String(row.delivery_status),
    });
  }
  return fallbackMap;
}

export async function getInitialInboxPayload(params: {
  userId: string;
  userName: string;
  userRole: UserRole;
  selectedConversationId?: string;
  initialFilter?: InboxQuickFilter;
}): Promise<InitialInboxPayload> {
  await ensureDatabasesBootstrapped();
  ensureBackgroundWorkersRunning();

  const conv = getRawLibSqlClient("conversations");
  const auth = getRawLibSqlClient("core_auth");
  const mkt = getRawLibSqlClient("marketing");

  const [threadsRes, teamsRes, staffRes, templatesRes, quickRepliesRes] =
    await Promise.all([
      conv.execute(
        `SELECT c.*
         FROM conversations c
         ORDER BY
           CASE WHEN c.status != 'RESOLVED' AND c.waiting_since IS NOT NULL THEN 0
                WHEN c.status != 'RESOLVED' THEN 1
                ELSE 2 END,
           c.last_message_at DESC
         LIMIT 400`
      ),
      conv.execute(`SELECT * FROM teams ORDER BY priority_rank ASC, name ASC`),
      auth.execute(
        `SELECT id, name, role, department, COALESCE(assignments_enabled, 1) AS assignments_enabled
         FROM users
         WHERE status = 'ACTIVE' AND role != 'CLIENT'
         ORDER BY name ASC`
      ),
      mkt.execute(
        `SELECT id, name, category, language, header_text, header_type, header_media_url, body_text, footer_text, cta_url, buttons_json, variables_schema_json
         FROM templates
         WHERE approval_status = 'APPROVED'
         ORDER BY
           CASE WHEN category = 'UTILITY' THEN 0
                WHEN category = 'MARKETING' THEN 1
                ELSE 2 END,
           name ASC`
      ),
      conv
        .execute({
          sql: `SELECT * FROM staff_quick_replies WHERE staff_id = ? OR is_shared = 1 ORDER BY usage_count DESC, updated_at DESC`,
          args: [params.userId],
        })
        .catch(() => ({ rows: [] as Record<string, unknown>[] })),
    ]);

  const missingIds = threadsRes.rows
    .filter((r) => !r.last_message_direction || !r.last_message_status)
    .map((r) => String(r.id));
  const fallbackMap = await fetchMissingLastMessageFallback(conv, missingIds);

  const threads: ConversationSummary[] = threadsRes.rows.map((r) => {
    const cid = String(r.id);
    const fb = fallbackMap.get(cid);
    const resolvedDir = r.last_message_direction
      ? String(r.last_message_direction)
      : fb?.direction || null;
    const resolvedStatus = r.last_message_status
      ? String(r.last_message_status)
      : fb?.status || null;

    return {
      id: cid,
      customerPhone: String(r.customer_phone),
      customerName: String(r.customer_name),
      customerId: r.customer_id ? String(r.customer_id) : null,
      status: String(r.status),
      priority: String(r.priority),
      smartCategory: String(r.smart_category),
      assignedStaffId: r.assigned_staff_id ? String(r.assigned_staff_id) : null,
      assignedStaffName: r.assigned_staff_name
        ? String(r.assigned_staff_name)
        : null,
      assignedTeamId: r.assigned_team_id ? String(r.assigned_team_id) : null,
      assignedTeamName: r.assigned_team_name
        ? String(r.assigned_team_name)
        : null,
      escalationLevel: String(r.escalation_level || "P0"),
      waitingSince: r.waiting_since ? String(r.waiting_since) : null,
      lastResponseSeconds:
        r.last_response_seconds !== null && r.last_response_seconds !== undefined
          ? Number(r.last_response_seconds)
          : null,
      escalatedAt: r.escalated_at ? String(r.escalated_at) : null,
      unreadCount: Number(r.unread_count ?? 0),
      lastMessagePreview: String(r.last_message_preview || ""),
      lastMessageAt: String(r.last_message_at),
      lastMessageDirection: resolvedDir,
      lastMessageStatus: resolvedStatus,
      windowExpiresAt: r.window_expires_at ? String(r.window_expires_at) : null,
      resolutionSummary: r.resolution_summary ? String(r.resolution_summary) : null,
      resolvedByName: r.resolved_by_name ? String(r.resolved_by_name) : null,
      tags: (() => {
        try {
          return JSON.parse(String(r.tags_json || "[]"));
        } catch {
          return [];
        }
      })(),
      collaborators: parseConversationCollaborators(r.collaborators_json),
    };
  });

  const teams: TeamOption[] = teamsRes.rows.map((t) => ({
    id: String(t.id),
    name: String(t.name),
    brandScope: String(t.brand_scope || "ALL"),
    priorityRank: Number(t.priority_rank ?? 10),
    p0WaitMinutes: Number(t.p0_wait_minutes ?? 5),
    p1WaitMinutes: Number(t.p1_wait_minutes ?? 12),
  }));

  const allowDevAssign = canAssignToDev(params.userRole);
  const staffList: StaffOption[] = staffRes.rows
    .filter(
      (s) =>
        String(s.role) !== "DEV" ||
        allowDevAssign ||
        String(s.id) === params.userId
    )
    .map((s) => ({
      id: String(s.id),
      name: String(s.name),
      role: String(s.role),
      department: String(s.department || "Operations"),
      assignmentsEnabled: Number(s.assignments_enabled ?? 1) !== 0,
    }));

  const templates: ApprovedTemplateOption[] = templatesRes.rows.map((tpl) => {
    const rawCat = String(tpl.category || "UTILITY");
    const category: "MARKETING" | "UTILITY" | "AUTHENTICATION" =
      rawCat === "MARKETING" || rawCat === "AUTHENTICATION" ? rawCat : "UTILITY";
    let buttons: { type: string; text: string }[] = [];
    try {
      const parsed = JSON.parse(String(tpl.buttons_json || "[]"));
      if (Array.isArray(parsed)) {
        buttons = parsed
          .map((b: Record<string, unknown>) => ({
            type: String(b.type || ""),
            text: String(b.text || ""),
          }))
          .filter((b) => b.text);
      }
    } catch {
      buttons = [];
    }
    let variablesSchema: TemplateVariableSpecOption[] = [];
    try {
      const parsed = JSON.parse(String(tpl.variables_schema_json || "[]"));
      if (Array.isArray(parsed)) {
        variablesSchema = parsed.map((v: Record<string, unknown>) => ({
          index: Number(v.index),
          label: String(v.label || ""),
          sourceField: String(v.sourceField || "custom"),
          sampleValue: String(v.sampleValue || ""),
        }));
      }
    } catch {
      variablesSchema = [];
    }
    const rawHdrMedia = tpl.header_media_url ? String(tpl.header_media_url).trim() : "";
    const validHdrMediaUrl = /^https?:\/\//i.test(rawHdrMedia) ? rawHdrMedia : null;
    return {
      id: String(tpl.id),
      name: String(tpl.name),
      category,
      language: String(tpl.language || "en"),
      headerText: tpl.header_text ? String(tpl.header_text) : null,
      headerType: String(tpl.header_type || "NONE"),
      headerMediaUrl: validHdrMediaUrl,
      bodyText: String(tpl.body_text || ""),
      footerText: tpl.footer_text ? String(tpl.footer_text) : null,
      ctaUrl: tpl.cta_url ? String(tpl.cta_url) : null,
      buttons,
      variablesSchema,
    };
  });

  const quickReplies: QuickReplyItem[] = quickRepliesRes.rows.map((qr) => ({
    id: String(qr.id),
    staffId: String(qr.staff_id),
    staffName: String(qr.staff_name || ""),
    cmd: String(qr.cmd),
    title: String(qr.title),
    body: String(qr.body),
    isShared: Number(qr.is_shared ?? 0) === 1,
    isMine: String(qr.staff_id) === params.userId,
  }));

  const preferredId = pickInitialConversationId({
    threads,
    currentUserId: params.userId,
    selectedConversationId: params.selectedConversationId,
    initialFilter: params.initialFilter,
  });

  const initialDetail = preferredId
    ? await getConversationDetailServer(preferredId, true)
    : null;

  if (preferredId) {
    const target = threads.find((t) => t.id === preferredId);
    if (target) target.unreadCount = 0;
  }

  return {
    currentUserId: params.userId,
    currentUserName: params.userName,
    currentUserRole: params.userRole,
    serverNowMs: Date.now(),
    threads,
    initialSelectedId: preferredId,
    initialDetail,
    initialFilter: params.initialFilter,
    requestedChatId: params.selectedConversationId,
    teams,
    staffList,
    templates,
    quickReplies,
  };
}
