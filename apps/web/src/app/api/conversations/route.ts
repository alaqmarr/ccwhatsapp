import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { sendStaffAssignmentEmailNotification, sendWhatsAppCloudMessage } from "@cc/connections";
import {
  ensureDatabasesBootstrapped,
  getRawLibSqlClient,
  parseConversationCollaborators,
  upsertSyncedContact,
} from "@cc/database";
import { canAssignToDev, hasPermission, normalizeWhatsAppNumber } from "@cc/rbac";
import { socketHub } from "@cc/sockets";
import {
  closeActiveAssignmentOnResolve,
  ensureBackgroundWorkersRunning,
  logConversationAssignment,
  markPriorOutboundMessagesRead,
  processInboundAutomations,
  recordAssignedFirstResponse,
  recordDualPricingLedgerEntry,
  scheduleSandboxDeliveryReceipt,
  type BillingMessageCategory,
} from "@cc/workers";
import { getCurrentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user || !hasPermission(user.role, "inbox:view", user.status)) {
    return NextResponse.json({ ok: false, error: "Active staff access required." }, { status: 403 });
  }

  await ensureDatabasesBootstrapped();
  ensureBackgroundWorkersRunning();

  const conv = getRawLibSqlClient("conversations");
  const { searchParams } = new URL(req.url);
  const statusFilter = searchParams.get("status") || "ALL";
  const categoryFilter = searchParams.get("category") || "ALL";
  const teamFilter = searchParams.get("teamId") || "ALL";
  const waitingOnly = searchParams.get("waiting") === "1";
  const acrioOnly = searchParams.get("acrio") === "1";
  const mineOnly = searchParams.get("mine") === "1";
  const staffFilter = searchParams.get("staffId") || "ALL";
  const activeOnly = searchParams.get("activeOnly") === "1";
  const searchQuery = (searchParams.get("q") || "").trim();
  const requestedLimit = Number(searchParams.get("limit") || 400);
  const limit = Math.min(Math.max(Number.isFinite(requestedLimit) ? requestedLimit : 400, 50), 1000);

  const whereParts: string[] = [];
  const args: (string | number)[] = [];
  if (statusFilter !== "ALL") {
    whereParts.push(`c.status = ?`);
    args.push(statusFilter);
  }
  if (activeOnly || waitingOnly || acrioOnly) {
    whereParts.push(`c.status != 'RESOLVED'`);
  }
  if (categoryFilter !== "ALL") {
    whereParts.push(`c.smart_category = ?`);
    args.push(categoryFilter);
  }
  if (teamFilter !== "ALL") {
    whereParts.push(`c.assigned_team_id = ?`);
    args.push(teamFilter);
  }
  if (waitingOnly) {
    whereParts.push(`c.waiting_since IS NOT NULL`);
  }
  if (acrioOnly) {
    whereParts.push(`c.assigned_staff_id = 'ACRIO'`);
  }
  if (searchQuery) {
    const like = `%${searchQuery}%`;
    whereParts.push(`(c.customer_name LIKE ? OR c.customer_phone LIKE ? OR c.last_message_preview LIKE ?)`);
    args.push(like, like, like);
  }

  const whereSql = whereParts.length > 0 ? `WHERE ${whereParts.join(" AND ")}` : "";
  args.push(limit);

  const res = await conv.execute({
    sql: `SELECT c.*,
            COALESCE(
              c.last_message_direction,
              (
                SELECT m.direction FROM messages m
                WHERE m.conversation_id = c.id AND m.direction IN ('INBOUND', 'OUTBOUND')
                ORDER BY m.created_at DESC, m.rowid DESC LIMIT 1
              )
            ) AS resolved_last_dir,
            COALESCE(
              c.last_message_status,
              (
                SELECT m.delivery_status FROM messages m
                WHERE m.conversation_id = c.id AND m.direction IN ('INBOUND', 'OUTBOUND')
                ORDER BY m.created_at DESC, m.rowid DESC LIMIT 1
              )
            ) AS resolved_last_status
          FROM conversations c
          ${whereSql}
          ORDER BY
            CASE WHEN c.status != 'RESOLVED' AND c.waiting_since IS NOT NULL THEN 0
                 WHEN c.status != 'RESOLVED' THEN 1
                 ELSE 2 END,
            c.last_message_at DESC
          LIMIT ?`,
    args,
  });

  let items = res.rows.map((r) => {
    const cid = String(r.id);
    return {
      id: cid,
      customerPhone: String(r.customer_phone),
      customerName: String(r.customer_name),
      customerId: r.customer_id ? String(r.customer_id) : null,
      status: String(r.status),
      priority: String(r.priority),
      smartCategory: String(r.smart_category),
      assignedStaffId: r.assigned_staff_id ? String(r.assigned_staff_id) : null,
      assignedStaffName: r.assigned_staff_name ? String(r.assigned_staff_name) : null,
      assignedTeamId: r.assigned_team_id ? String(r.assigned_team_id) : null,
      assignedTeamName: r.assigned_team_name ? String(r.assigned_team_name) : null,
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
      lastMessageDirection: r.resolved_last_dir ? String(r.resolved_last_dir) : null,
      lastMessageStatus: r.resolved_last_status ? String(r.resolved_last_status) : null,
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

  if (statusFilter !== "ALL") {
    items = items.filter((c) => c.status === statusFilter);
  }
  if (activeOnly) {
    items = items.filter((c) => c.status !== "RESOLVED");
  }
  if (categoryFilter !== "ALL") {
    items = items.filter((c) => c.smartCategory === categoryFilter);
  }
  if (teamFilter !== "ALL") {
    items = items.filter((c) => c.assignedTeamId === teamFilter);
  }
  if (waitingOnly) {
    items = items.filter((c) => c.status !== "RESOLVED" && Boolean(c.waitingSince));
  }
  if (acrioOnly) {
    items = items.filter((c) => c.status !== "RESOLVED" && c.assignedStaffId === "ACRIO");
  }
  if (mineOnly) {
    items = items.filter(
      (c) =>
        c.assignedStaffId === user.id ||
        c.collaborators.some((cb) => cb.staffId === user.id)
    );
  }
  if (staffFilter !== "ALL") {
    items = items.filter(
      (c) =>
        c.assignedStaffId === staffFilter ||
        c.collaborators.some((cb) => cb.staffId === staffFilter)
    );
  }

  return NextResponse.json({ ok: true, conversations: items });
}

/**
 * Simulates an incoming customer WhatsApp message (for Test Mode) or starts a new outbound customer thread.
 * Initial inbound assignment is ALWAYS ACRIO, which handles the query automatically in the backend and
 * hands off to Sales Team (P0) only if the customer asks for staff or ACRIO cannot resolve.
 */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user || !hasPermission(user.role, "inbox:reply", user.status)) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  await ensureDatabasesBootstrapped();
  const body = await req.json().catch(() => ({}));
  const conv = getRawLibSqlClient("conversations");
  const crm = getRawLibSqlClient("crm_orders");
  const nowIso = new Date().toISOString();

  // Bulk Inbox Actions (Known Issue #13: Bulk Resolve & Bulk Assign)
  if (body.action === "bulk_resolve") {
    const ids: string[] = Array.isArray(body.conversationIds)
      ? body.conversationIds.map(String).filter(Boolean)
      : [];
    if (ids.length === 0) {
      return NextResponse.json(
        { ok: false, error: "Select at least one conversation." },
        { status: 400 }
      );
    }
    const summary = String(body.resolutionSummary || `Resolved by ${user.name}.`).trim();
    for (const cid of ids) {
      await conv.execute({
        sql: `UPDATE conversations
              SET status = 'RESOLVED',
                  waiting_since = NULL,
                  escalation_level = 'P0',
                  resolution_summary = ?,
                  resolved_by_id = ?,
                  resolved_by_name = ?,
                  resolved_at = ?
              WHERE id = ?`,
        args: [summary, user.id, user.name, nowIso, cid],
      });
      await closeActiveAssignmentOnResolve(cid, nowIso).catch(() => {});
    }
    socketHub.emit("conversation:resolved", { conversationIds: ids, resolvedBy: user.name });
    return NextResponse.json({ ok: true, updatedCount: ids.length });
  }

  if (body.action === "bulk_assign") {
    const ids: string[] = Array.isArray(body.conversationIds)
      ? body.conversationIds.map(String).filter(Boolean)
      : [];
    const targetStaffId = String(body.staffId || user.id);
    if (ids.length === 0) {
      return NextResponse.json(
        { ok: false, error: "Select at least one conversation." },
        { status: 400 }
      );
    }
    let targetStaffName = String(body.staffName || user.name);
    let targetEmail = "";
    if (targetStaffId !== "ACRIO") {
      const auth = getRawLibSqlClient("core_auth");
      const uRes = await auth.execute({
        sql: `SELECT id, name, email, role FROM users WHERE id = ? LIMIT 1`,
        args: [targetStaffId],
      });
      if (uRes.rows[0]) {
        targetStaffName = String(uRes.rows[0].name || targetStaffName);
        targetEmail = String(uRes.rows[0].email || "");
        if (
          String(uRes.rows[0].role) === "DEV" &&
          targetStaffId !== user.id &&
          !canAssignToDev(user.role)
        ) {
          return NextResponse.json(
            { ok: false, error: "Only Managers and Superadmins can assign Dev accounts." },
            { status: 403 }
          );
        }
      }
    }

    for (const cid of ids) {
      const cCheck = await conv.execute({
        sql: `SELECT customer_phone, customer_name, smart_category, priority, last_message_preview FROM conversations WHERE id = ? LIMIT 1`,
        args: [cid],
      });
      const cRow = cCheck.rows[0];
      if (!cRow) continue;

      if (targetStaffId === "ACRIO") {
        await conv.execute({
          sql: `UPDATE conversations
                SET status = 'OPEN',
                    assigned_staff_id = 'ACRIO',
                    assigned_staff_name = 'ACRIO',
                    assigned_team_id = NULL,
                    assigned_team_name = 'System (ACRIO)',
                    escalation_level = 'P0',
                    waiting_since = NULL
                WHERE id = ?`,
          args: [cid],
        });
      } else {
        await conv.execute({
          sql: `UPDATE conversations
                SET status = 'ASSIGNED',
                    assigned_staff_id = ?,
                    assigned_staff_name = ?,
                    assigned_team_id = COALESCE(assigned_team_id, 'team_sales'),
                    assigned_team_name = COALESCE(NULLIF(assigned_team_name, 'System (ACRIO)'), 'Sales Team'),
                    escalation_level = 'P0'
                WHERE id = ?`,
          args: [targetStaffId, targetStaffName, cid],
        });
        if (targetStaffId !== user.id) {
          sendStaffAssignmentEmailNotification({
            staffId: targetStaffId,
            staffEmail: targetEmail || undefined,
            staffName: targetStaffName,
            customerName: String(cRow.customer_name || ""),
            customerPhone: String(cRow.customer_phone || ""),
            smartCategory: String(cRow.smart_category || "General Enquiry"),
            priority: String(cRow.priority || "NORMAL"),
            teamName: "Sales Team",
            reason: `Assigned by ${user.name} (Bulk Inbox Action)`,
            latestMessage: String(cRow.last_message_preview || ""),
            conversationId: cid,
          }).catch(() => {});
        }
      }
    }
    socketHub.emit("conversation:assigned", { conversationIds: ids, staffName: targetStaffName });
    return NextResponse.json({ ok: true, updatedCount: ids.length });
  }

  const phoneCheck = normalizeWhatsAppNumber(String(body.customerPhone || ""));
  if (!phoneCheck.valid) {
    return NextResponse.json({ ok: false, error: phoneCheck.error }, { status: 400 });
  }

  const customerName = String(body.customerName || phoneCheck.e164).trim();
  const text = String(body.messageText || "Hello Classic Concepts, I have a product enquiry.").trim();
  const direction = body.direction === "OUTBOUND" ? "OUTBOUND" : "INBOUND";
  const templateName = body.templateName ? String(body.templateName).trim() : undefined;
  const isTemplate = direction === "OUTBOUND" && Boolean(templateName || body.messageType === "TEMPLATE");

  let tplRecord: Record<string, unknown> | null = null;
  if (isTemplate && templateName) {
    const mkt = getRawLibSqlClient("marketing");
    const tplCheck = await mkt.execute({
      sql: `SELECT approval_status, language, header_type, header_media_url, variables_schema_json FROM templates WHERE name = ? LIMIT 1`,
      args: [templateName],
    });
    if (tplCheck.rows[0]) {
      tplRecord = tplCheck.rows[0] as Record<string, unknown>;
      if (String(tplRecord.approval_status) !== "APPROVED") {
        return NextResponse.json(
          {
            ok: false,
            error: `Only Meta-approved templates can be sent (template "${templateName}" is ${String(
              tplRecord.approval_status
            )}).`,
          },
          { status: 400 }
        );
      }
    }
  }

  const windowExp = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  // Upsert CRM customer
  const existingCust = await crm.execute({
    sql: `SELECT id FROM customers WHERE phone = ? LIMIT 1`,
    args: [phoneCheck.e164],
  });
  let customerId = existingCust.rows[0] ? String(existingCust.rows[0].id) : "";
  if (!customerId) {
    customerId = `cust_${crypto.randomUUID().slice(0, 8)}`;
    await crm.execute({
      sql: `INSERT INTO customers (
        id, phone, name, organization_type, acrio_segment, last_interaction_at, created_at
      ) VALUES (?, ?, ?, ?, 'New WhatsApp Lead', ?, ?)`,
      args: [
        customerId,
        phoneCheck.e164,
        customerName,
        String(body.organizationType || "Business"),
        nowIso,
        nowIso,
      ],
    });
  }

  await upsertSyncedContact({
    phone: phoneCheck.e164,
    name: customerName,
    organizationType: body.organizationType ? String(body.organizationType) : undefined,
    source: direction === "INBOUND" ? "WHATSAPP_INBOUND" : "MANUAL",
    lastContactedAt: nowIso,
  }).catch(() => {});

  const existingConv = await conv.execute({
    sql: `SELECT id, status, assigned_staff_id FROM conversations WHERE customer_phone = ? LIMIT 1`,
    args: [phoneCheck.e164],
  });

  const isNew = existingConv.rows.length === 0;
  const prevStatus = existingConv.rows[0] ? String(existingConv.rows[0].status) : "";
  const prevStaffId = existingConv.rows[0]?.assigned_staff_id
    ? String(existingConv.rows[0].assigned_staff_id)
    : null;
  const convId = isNew
    ? `conv_${crypto.randomUUID().slice(0, 8)}`
    : String(existingConv.rows[0].id);

  if (isNew) {
    await conv.execute({
      sql: `INSERT INTO conversations (
        id, customer_phone, customer_name, customer_id, status, priority, smart_category,
        assigned_staff_id, assigned_staff_name, assigned_team_id, assigned_team_name,
        escalation_level, waiting_since, unread_count, last_message_preview, last_message_at, window_expires_at, created_at
      ) VALUES (?, ?, ?, ?, ?, 'NORMAL', 'General Enquiry', ?, ?, ?, ?, 'P0', NULL, ?, ?, ?, ?, ?)`,
      args: [
        convId,
        phoneCheck.e164,
        customerName,
        customerId,
        direction === "INBOUND" ? "OPEN" : "ASSIGNED",
        direction === "INBOUND" ? "ACRIO" : user.id,
        direction === "INBOUND" ? "ACRIO" : user.name,
        direction === "INBOUND" ? null : "team_sales",
        direction === "INBOUND" ? "System (ACRIO)" : "Sales Team",
        direction === "INBOUND" ? 1 : 0,
        text.slice(0, 140),
        nowIso,
        direction === "INBOUND" ? windowExp : null,
        nowIso,
      ],
    });
  } else if (direction === "INBOUND") {
    // Only assign to System (ACRIO) when customer initiates a fresh conversation after RESOLVED.
    // If already open with human staff/team, NEVER switch back to ACRIO automatically!
    const resetToAcrio = prevStatus === "RESOLVED";
    const isHumanOwned = !resetToAcrio && prevStaffId !== "ACRIO";
    await conv.execute({
      sql: `UPDATE conversations
            SET status = CASE WHEN status = 'RESOLVED' THEN 'OPEN' ELSE status END,
                assigned_staff_id = CASE WHEN ? = 1 THEN 'ACRIO' ELSE assigned_staff_id END,
                assigned_staff_name = CASE WHEN ? = 1 THEN 'ACRIO' ELSE assigned_staff_name END,
                assigned_team_id = CASE WHEN ? = 1 THEN NULL ELSE assigned_team_id END,
                assigned_team_name = CASE WHEN ? = 1 THEN 'System (ACRIO)' ELSE assigned_team_name END,
                escalation_level = CASE WHEN ? = 1 THEN 'P0' ELSE escalation_level END,
                waiting_since = CASE WHEN ? = 1 THEN COALESCE(waiting_since, ?) ELSE waiting_since END,
                unread_count = unread_count + 1,
                last_message_preview = ?,
                last_message_at = ?,
                window_expires_at = ?
            WHERE id = ?`,
      args: [
        resetToAcrio ? 1 : 0,
        resetToAcrio ? 1 : 0,
        resetToAcrio ? 1 : 0,
        resetToAcrio ? 1 : 0,
        resetToAcrio ? 1 : 0,
        isHumanOwned ? 1 : 0,
        nowIso,
        text.slice(0, 140),
        nowIso,
        windowExp,
        convId,
      ],
    });
  } else {
    await conv.execute({
      sql: `UPDATE conversations
            SET status = 'ASSIGNED',
                assigned_staff_id = ?,
                assigned_staff_name = ?,
                assigned_team_id = COALESCE(assigned_team_id, 'team_sales'),
                assigned_team_name = CASE
                  WHEN assigned_team_id IS NULL THEN 'Sales Team'
                  ELSE assigned_team_name
                END,
                waiting_since = NULL,
                last_message_preview = ?,
                last_message_at = ?
            WHERE id = ?`,
      args: [user.id, user.name, text.slice(0, 140), nowIso, convId],
    });
  }

  const resetToAcrio = !isNew && direction === "INBOUND" && prevStatus === "RESOLVED";
  if (direction === "INBOUND" && (isNew || resetToAcrio)) {
    const assignIso = new Date(Math.max(0, new Date(nowIso).getTime() - 2)).toISOString();
    await logConversationAssignment({
      conversationId: convId,
      customerPhone: phoneCheck.e164,
      customerName,
      toStaffId: "ACRIO",
      toStaffName: "ACRIO",
      toTeamId: null,
      toTeamName: "System (ACRIO)",
      escalationLevel: "P0",
      assignmentSource: "INITIAL_SYSTEM",
      assignedByName: "System",
      reason: isNew
        ? "Customer started a new WhatsApp chat"
        : "Customer messaged after previous resolution",
      assignedAt: assignIso,
    });
  } else if (direction === "OUTBOUND" && isNew) {
    const assignIso = new Date(Math.max(0, new Date(nowIso).getTime() - 2)).toISOString();
    await logConversationAssignment({
      conversationId: convId,
      customerPhone: phoneCheck.e164,
      customerName,
      toStaffId: user.id,
      toStaffName: user.name,
      toTeamId: "team_sales",
      toTeamName: "Sales Team",
      escalationLevel: "P0",
      assignmentSource: "OUTBOUND_START",
      assignedByName: user.name,
      reason: "Staff initiated outbound WhatsApp chat",
      assignedAt: assignIso,
    });
  }

  let deliveryStatus = "DELIVERED";
  let waMessageId: string | null = null;
  let sandboxMode = false;
  if (direction === "OUTBOUND") {
    /* Forward template components and language code to prevent Meta error 132000 */
    let templateComponents: Record<string, unknown>[] | undefined = Array.isArray(
      body.templateComponents
    )
      ? (body.templateComponents as Record<string, unknown>[])
      : undefined;

    if (
      !templateComponents &&
      (Array.isArray(body.templateVariables) || Array.isArray(body.variables))
    ) {
      const rawVars = (body.templateVariables || body.variables) as unknown[];
      if (rawVars.length > 0) {
        templateComponents = [
          {
            type: "body",
            parameters: rawVars.map((v) => ({
              type: "text",
              text: String(v ?? ""),
            })),
          },
        ];
      }
    }

    const headerType = String(tplRecord?.header_type || "NONE").toUpperCase();
    const headerMediaUrl = body.headerMediaUrl
      ? String(body.headerMediaUrl).trim()
      : tplRecord?.header_media_url
      ? String(tplRecord.header_media_url).trim()
      : "";
    if (
      (headerType === "IMAGE" || headerType === "VIDEO" || headerType === "DOCUMENT") &&
      headerMediaUrl
    ) {
      if (!templateComponents) templateComponents = [];
      const hasHeader = templateComponents.some(
        (c) => String(c?.type || "").toLowerCase() === "header"
      );
      if (!hasHeader) {
        const mediaKey = headerType.toLowerCase();
        templateComponents.unshift({
          type: "header",
          parameters: [{ type: mediaKey, [mediaKey]: { link: headerMediaUrl } }],
        });
      }
    }

    const languageCode = body.languageCode
      ? String(body.languageCode).trim()
      : tplRecord?.language
      ? String(tplRecord.language).trim()
      : undefined;

    const sendRes = await sendWhatsAppCloudMessage({
      toPhone: phoneCheck.e164,
      bodyText: text,
      templateName,
      templateComponents,
      languageCode,
      skipAutoChatRecord: Boolean(templateName),
      simulateAsyncDelivery: true,
      forceSandbox: Boolean(body.forceSandbox),
    });
    deliveryStatus = sendRes.deliveryStatus;
    waMessageId = sendRes.waMessageId;
    sandboxMode = sendRes.ok && sendRes.mode === "SANDBOX_SIMULATOR";
  } else {
    await markPriorOutboundMessagesRead(convId);
  }

  const templateCategory: BillingMessageCategory =
    body.billingCategory === "MARKETING"
      ? "MARKETING"
      : body.billingCategory === "AUTHENTICATION"
      ? "AUTHENTICATION"
      : "UTILITY";

  const msgId = `msg_${crypto.randomUUID().slice(0, 8)}`;
  await conv.execute({
    sql: `INSERT INTO messages (
      id, conversation_id, direction, sender_type, sender_staff_id, sender_name, message_type,
      billing_category, body, template_name, wa_message_id, delivery_status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      msgId,
      convId,
      direction,
      direction === "INBOUND" ? "CUSTOMER" : "STAFF",
      direction === "INBOUND" ? null : user.id,
      direction === "INBOUND" ? customerName : user.name,
      isTemplate ? "TEMPLATE" : "TEXT",
      isTemplate ? templateCategory : "FREE_CHAT",
      text,
      templateName || null,
      waMessageId,
      deliveryStatus,
      nowIso,
    ],
  });

  if (direction === "OUTBOUND") {
    await recordAssignedFirstResponse({
      conversationId: convId,
      responderId: user.id,
      responderName: user.name,
      responderTeamId: "team_sales",
      responderTeamName: "Sales Team",
      messageId: msgId,
      respondedAt: nowIso,
    });
  }

  if (direction === "OUTBOUND" && sandboxMode && waMessageId) {
    scheduleSandboxDeliveryReceipt({
      conversationId: convId,
      messageId: msgId,
      waMessageId,
    });
  }

  // Charge ONLY if an outbound Template message was sent! Regular chat is ₹0.00 (Free).
  if (isTemplate) {
    await recordDualPricingLedgerEntry({
      messageId: msgId,
      conversationId: convId,
      customerPhone: phoneCheck.e164,
      category: templateCategory,
      staffName: user.name,
      deliveryMode: sandboxMode ? "SANDBOX_SIMULATOR" : "LIVE_META_CLOUD",
    });
  }

  if (direction === "INBOUND") {
    await processInboundAutomations({
      conversationId: convId,
      customerPhone: phoneCheck.e164,
      inboundText: text,
      isNewConversation: isNew || prevStatus === "RESOLVED",
      isButtonClick: Boolean(body.isButtonClick),
      buttonPayload: body.buttonPayload ? String(body.buttonPayload) : undefined,
      buttonText: body.buttonText ? String(body.buttonText) : undefined,
    });
  }

  socketHub.emit("message:new", { conversationId: convId, customerName, text });
  return NextResponse.json({ ok: true, conversationId: convId });
}
