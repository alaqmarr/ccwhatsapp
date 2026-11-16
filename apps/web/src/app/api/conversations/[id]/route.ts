import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { listAllStaffAccounts } from "@cc/auth";
import {
  ensureDatabasesBootstrapped,
  fetchWebsiteEnquiriesForCustomer,
  getRawLibSqlClient,
  listOrderTrackings,
  upsertOrderTracking,
  upsertSyncedContact,
  type ShipmentStatus,
} from "@cc/database";
import {
  formatWhatsAppOutboundText,
  getCachedEcosystemCatalog,
  sendStaffAssignmentEmailNotification,
  sendWhatsAppCloudMessage,
} from "@cc/connections";
import { canAssignToDev, hasPermission, isDevRole } from "@cc/rbac";
import { socketHub } from "@cc/sockets";
import { listCustomAdminLinks, rememberWhatsAppCache } from "@cc/storage";
import {
  checkAndEscalateWaitingChats,
  closeActiveAssignmentOnResolve,
  logConversationAssignment,
  markPriorOutboundMessagesRead,
  processInboundAutomations,
  processStaffNote,
  recordAssignedFirstResponse,
  recordDualPricingLedgerEntry,
  scheduleSandboxDeliveryReceipt,
  smartAssignConversation,
  type BillingMessageCategory,
} from "@cc/workers";
import { getCurrentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user || !hasPermission(user.role, "inbox:view", user.status)) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  await ensureDatabasesBootstrapped();
  await checkAndEscalateWaitingChats().catch(() => {});

  const { id } = await context.params;
  const conv = getRawLibSqlClient("conversations");
  const crm = getRawLibSqlClient("crm_orders");

  const convRes = await conv.execute({
    sql: `SELECT * FROM conversations WHERE id = ? LIMIT 1`,
    args: [id],
  });
  if (!convRes.rows[0]) {
    return NextResponse.json({ ok: false, error: "Conversation not found." }, { status: 404 });
  }
  const cRow = convRes.rows[0] as Record<string, unknown>;
  const customerPhone = String(cRow.customer_phone);

  // Reset unread count on open
  await conv.execute({
    sql: `UPDATE conversations SET unread_count = 0 WHERE id = ?`,
    args: [id],
  });

  await getCachedEcosystemCatalog().catch(() => null);
  const [
    msgRes,
    assignRes,
    custRes,
    ordersRes,
    relationsRes,
    customLinks,
    teamsRes,
    orderTrackings,
  ] = await Promise.all([
    conv.execute({
      sql: `SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC`,
      args: [id],
    }),
    conv.execute({
      sql: `SELECT * FROM conversation_assignments WHERE conversation_id = ? ORDER BY assigned_at DESC`,
      args: [id],
    }),
    crm.execute({
      sql: `SELECT * FROM customers WHERE phone = ? LIMIT 1`,
      args: [customerPhone],
    }),
    crm.execute({
      sql: `SELECT * FROM customer_orders WHERE customer_phone = ? ORDER BY ordered_at DESC`,
      args: [customerPhone],
    }),
    crm.execute({
      sql: `SELECT * FROM customer_relations WHERE customer_phone = ? ORDER BY occurred_at DESC`,
      args: [customerPhone],
    }),
    listCustomAdminLinks(),
    conv.execute(`SELECT * FROM teams ORDER BY priority_rank ASC, name ASC`),
    listOrderTrackings({ customerPhone }).catch(() => []),
  ]);

  const customerRow = custRes.rows[0] as Record<string, unknown> | undefined;
  const lookupKey = customerRow?.email ? String(customerRow.email) : customerPhone;
  const websiteEnquiries = await rememberWhatsAppCache(
    `customer-enq:${lookupKey}`,
    ["customer-history"],
    300,
    () => fetchWebsiteEnquiriesForCustomer(lookupKey)
  );

  const messages = msgRes.rows.map((m) => {
    let metadata: Record<string, unknown> | null = null;
    if (m.metadata_json) {
      try {
        metadata = JSON.parse(String(m.metadata_json));
      } catch {
        metadata = null;
      }
    }
    return {
      id: String(m.id),
      direction: String(m.direction),
      senderType: String(m.sender_type),
      senderName: String(m.sender_name),
      messageType: String(m.message_type),
      billingCategory: String(m.billing_category),
      body: String(m.body),
      templateName: m.template_name ? String(m.template_name) : null,
      waMessageId: m.wa_message_id ? String(m.wa_message_id) : null,
      deliveryStatus: String(m.delivery_status),
      createdAt: String(m.created_at),
      metadata,
    };
  });

  const assignments = assignRes.rows.map((a) => ({
    id: String(a.id),
    conversationId: String(a.conversation_id),
    fromStaffId: a.from_staff_id ? String(a.from_staff_id) : null,
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
    firstResponseMessageId: a.first_response_message_id
      ? String(a.first_response_message_id)
      : null,
    endedAt: a.ended_at ? String(a.ended_at) : null,
    outcome: String(a.outcome || "ACTIVE"),
  }));

  const orders = ordersRes.rows.map((o) => ({
    id: String(o.id),
    orderNumber: String(o.order_number),
    itemsSummary: String(o.items_summary),
    quantity: Number(o.quantity ?? 1),
    totalAmountInr: Number(o.total_amount_inr ?? 0),
    paymentStatus: String(o.payment_status),
    fulfillmentStatus: String(o.fulfillment_status),
    invoiceUrl: o.invoice_url ? String(o.invoice_url) : null,
    orderedAt: String(o.ordered_at),
  }));

  const relations = relationsRes.rows.map((r) => ({
    id: String(r.id),
    relationType: String(r.relation_type),
    summary: String(r.summary),
    handledBy: String(r.handled_by),
    occurredAt: String(r.occurred_at),
  }));

  const teams = teamsRes.rows.map((t) => ({
    id: String(t.id),
    name: String(t.name),
    brandScope: String(t.brand_scope || "ALL"),
    p0WaitMinutes: Number(t.p0_wait_minutes ?? 5),
    p1WaitMinutes: Number(t.p1_wait_minutes ?? 12),
  }));

  // Never run ACRIO on chat open/refresh - ACRIO only runs in the backend when assigned to System (ACRIO)
  const acrio = null;

  return NextResponse.json({
    ok: true,
    conversation: {
      id: String(cRow.id),
      customerPhone,
      customerName: String(cRow.customer_name),
      status: String(cRow.status),
      priority: String(cRow.priority),
      smartCategory: String(cRow.smart_category),
      assignedStaffId: cRow.assigned_staff_id ? String(cRow.assigned_staff_id) : null,
      assignedStaffName: cRow.assigned_staff_name ? String(cRow.assigned_staff_name) : null,
      assignedTeamId: cRow.assigned_team_id ? String(cRow.assigned_team_id) : null,
      assignedTeamName: cRow.assigned_team_name ? String(cRow.assigned_team_name) : null,
      escalationLevel: String(cRow.escalation_level || "P0"),
      waitingSince: cRow.waiting_since ? String(cRow.waiting_since) : null,
      lastResponseSeconds:
        cRow.last_response_seconds !== null && cRow.last_response_seconds !== undefined
          ? Number(cRow.last_response_seconds)
          : null,
      escalatedAt: cRow.escalated_at ? String(cRow.escalated_at) : null,
      resolutionSummary: cRow.resolution_summary ? String(cRow.resolution_summary) : null,
      resolvedByName: cRow.resolved_by_name ? String(cRow.resolved_by_name) : null,
      windowExpiresAt: cRow.window_expires_at ? String(cRow.window_expires_at) : null,
    },
    messages,
    assignments,
    teams,
    customer: customerRow
      ? {
          id: String(customerRow.id),
          phone: String(customerRow.phone),
          name: String(customerRow.name),
          email: customerRow.email ? String(customerRow.email) : null,
          companyName: customerRow.company_name ? String(customerRow.company_name) : null,
          organizationType: String(customerRow.organization_type || "Business"),
          city: customerRow.city ? String(customerRow.city) : null,
          gstNumber: customerRow.gst_number ? String(customerRow.gst_number) : null,
          acrioSegment: String(customerRow.acrio_segment || "Active Lead"),
          lifetimeValueInr: Number(customerRow.lifetime_value_inr ?? 0),
          totalOrdersCount: Number(customerRow.total_orders_count ?? 0),
          notes: String(customerRow.notes || ""),
        }
      : null,
    orders,
    orderTrackings,
    relations,
    websiteEnquiries,
    acrio,
    customLinks,
  });
}

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user || !hasPermission(user.role, "inbox:reply", user.status)) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  await ensureDatabasesBootstrapped();
  const { id } = await context.params;
  const body = await req.json().catch(() => ({}));
  const action = String(body.action || "send_message");

  const conv = getRawLibSqlClient("conversations");
  const crm = getRawLibSqlClient("crm_orders");
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();

  const cRes = await conv.execute({
    sql: `SELECT * FROM conversations WHERE id = ? LIMIT 1`,
    args: [id],
  });
  if (!cRes.rows[0]) {
    return NextResponse.json({ ok: false, error: "Conversation not found." }, { status: 404 });
  }
  const cRow = cRes.rows[0] as Record<string, unknown>;
  const customerPhone = String(cRow.customer_phone);

  const resolveQuotedReply = async () => {
    const rawReplyObj =
      body.replyTo && typeof body.replyTo === "object"
        ? (body.replyTo as Record<string, unknown>)
        : null;
    const requestedMsgId = String(
      body.replyToMessageId || rawReplyObj?.messageId || ""
    ).trim();

    if (requestedMsgId && !requestedMsgId.startsWith("optimistic_")) {
      const origRes = await conv.execute({
        sql: `SELECT id, wa_message_id, sender_name, sender_type, direction, body
              FROM messages
              WHERE id = ? AND conversation_id = ?
              LIMIT 1`,
        args: [requestedMsgId, id],
      });
      const orig = origRes.rows[0] as Record<string, unknown> | undefined;
      if (orig) {
        return {
          messageId: String(orig.id),
          waMessageId: orig.wa_message_id ? String(orig.wa_message_id) : null,
          senderName: String(orig.sender_name || ""),
          senderType: String(orig.sender_type || ""),
          direction: String(orig.direction || ""),
          body: String(orig.body || "").slice(0, 280),
        };
      }
    }

    if (rawReplyObj && String(rawReplyObj.body || "").trim()) {
      return {
        messageId: requestedMsgId || null,
        waMessageId: rawReplyObj.waMessageId
          ? String(rawReplyObj.waMessageId)
          : null,
        senderName: String(rawReplyObj.senderName || "Message"),
        senderType: rawReplyObj.senderType ? String(rawReplyObj.senderType) : "",
        direction: rawReplyObj.direction ? String(rawReplyObj.direction) : "",
        body: String(rawReplyObj.body || "").slice(0, 280),
      };
    }

    return null;
  };

  // 1. Outbound WhatsApp Reply
  // Regular 24h window chat is 100% FREE (₹0.00).
  // ONLY Templated messages (MARKETING ₹0.95, UTILITY/AUTHENTICATION ₹0.30) are billed here!
  if (action === "send_message") {
    const text = String(body.text || "").trim();
    if (!text) {
      return NextResponse.json({ ok: false, error: "Message cannot be empty." }, { status: 400 });
    }

    const templateName = body.templateName ? String(body.templateName).trim() : undefined;
    const isTemplate = body.messageType === "TEMPLATE" || Boolean(templateName);
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
              error: `Only official Meta-APPROVED templates can be sent on WhatsApp ("${templateName}" is ${String(
                tplRecord.approval_status
              )}).`,
            },
            { status: 400 }
          );
        }
      }
    }
    const templateBillingCategory: BillingMessageCategory =
      body.billingCategory === "MARKETING"
        ? "MARKETING"
        : body.billingCategory === "AUTHENTICATION"
        ? "AUTHENTICATION"
        : "UTILITY";

    const replyMeta = await resolveQuotedReply();
    const rawCta =
      body.ctaButton && typeof body.ctaButton === "object"
        ? (body.ctaButton as Record<string, unknown>)
        : null;
    const ctaButtonMeta =
      rawCta && String(rawCta.url || "").trim()
        ? {
            label: String(rawCta.label || "Track Order").trim().slice(0, 20),
            url: String(rawCta.url || "").trim(),
            orderId: rawCta.orderId ? String(rawCta.orderId) : undefined,
            providerName: rawCta.providerName
              ? String(rawCta.providerName)
              : undefined,
            awbNumber: rawCta.awbNumber ? String(rawCta.awbNumber) : undefined,
          }
        : null;

    const metaObj: Record<string, unknown> = {};
    if (replyMeta) metaObj.replyTo = replyMeta;
    if (ctaButtonMeta) metaObj.ctaButton = ctaButtonMeta;
    const metadataJson = JSON.stringify(metaObj);

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
      toPhone: customerPhone,
      bodyText: text,
      templateName,
      templateComponents,
      languageCode,
      replyToWaMessageId: replyMeta?.waMessageId || undefined,
      ctaButton: ctaButtonMeta
        ? {
            label: ctaButtonMeta.label,
            url: ctaButtonMeta.url,
            footerText: "Classic Concepts & Classic Edge 53",
          }
        : undefined,
      simulateAsyncDelivery: true,
      forceSandbox: Boolean(body.forceSandbox),
    });

    let responseSeconds: number | null =
      cRow.last_response_seconds !== null && cRow.last_response_seconds !== undefined
        ? Number(cRow.last_response_seconds)
        : null;
    if (cRow.waiting_since) {
      const waitStart = new Date(String(cRow.waiting_since)).getTime();
      if (!Number.isNaN(waitStart)) {
        responseSeconds = Math.max(1, Math.round((nowMs - waitStart) / 1000));
      }
    }

    const wasAcrioOrUnassigned =
      !cRow.assigned_staff_id || String(cRow.assigned_staff_id) === "ACRIO";
    const shouldAutoAssignSender =
      wasAcrioOrUnassigned ||
      (isDevRole(user.role) && String(cRow.assigned_staff_id || "") !== user.id);
    const storedBody = isTemplate ? text : formatWhatsAppOutboundText(text);
    const previewBody = storedBody.replace(/\s*\n+\s*/g, " ").slice(0, 140);

    const msgId = `msg_${crypto.randomUUID().slice(0, 8)}`;
    await conv.batch(
      [
        {
          sql: `INSERT INTO messages (
            id, conversation_id, direction, sender_type, sender_staff_id, sender_name, message_type,
            billing_category, body, template_name, metadata_json, wa_message_id, delivery_status, created_at
          ) VALUES (?, ?, 'OUTBOUND', 'STAFF', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [
            msgId,
            id,
            user.id,
            user.name,
            isTemplate ? "TEMPLATE" : "TEXT",
            isTemplate ? templateBillingCategory : "FREE_CHAT",
            storedBody,
            templateName || null,
            metadataJson,
            sendRes.waMessageId,
            sendRes.deliveryStatus,
            nowIso,
          ],
        },
        {
          sql: `UPDATE conversations
                SET status = 'ASSIGNED',
                    assigned_staff_id = CASE WHEN ? = 1 THEN ? ELSE assigned_staff_id END,
                    assigned_staff_name = CASE WHEN ? = 1 THEN ? ELSE assigned_staff_name END,
                    assigned_team_id = CASE WHEN ? = 1 THEN COALESCE(assigned_team_id, 'team_sales') ELSE assigned_team_id END,
                    assigned_team_name = CASE
                      WHEN ? = 1 AND (assigned_team_id IS NULL OR assigned_team_name = 'System (ACRIO)') THEN 'Sales Team'
                      ELSE assigned_team_name
                    END,
                    waiting_since = NULL,
                    last_response_seconds = ?,
                    escalation_level = 'P0',
                    last_message_preview = ?,
                    last_message_at = ?
                WHERE id = ?`,
          args: [
            shouldAutoAssignSender ? 1 : 0,
            user.id,
            shouldAutoAssignSender ? 1 : 0,
            user.name,
            shouldAutoAssignSender ? 1 : 0,
            shouldAutoAssignSender ? 1 : 0,
            responseSeconds,
            previewBody,
            nowIso,
            id,
          ],
        },
      ],
      "write"
    );

    if (shouldAutoAssignSender) {
      await logConversationAssignment({
        conversationId: id,
        customerPhone,
        customerName: String(cRow.customer_name || ""),
        fromStaffId: cRow.assigned_staff_id ? String(cRow.assigned_staff_id) : "ACRIO",
        fromStaffName: cRow.assigned_staff_name ? String(cRow.assigned_staff_name) : "ACRIO",
        fromTeamName: cRow.assigned_team_name ? String(cRow.assigned_team_name) : "System (ACRIO)",
        toStaffId: user.id,
        toStaffName: user.name,
        toTeamId: cRow.assigned_team_id ? String(cRow.assigned_team_id) : "team_sales",
        toTeamName:
          cRow.assigned_team_name && String(cRow.assigned_team_name) !== "System (ACRIO)"
            ? String(cRow.assigned_team_name)
            : "Sales Team",
        escalationLevel: "P0",
        assignmentSource: "STAFF_TAKEOVER",
        assignedByName: user.name,
        reason: `${user.name} replied in chat and took ownership`,
        assignedAt: nowIso,
      }).catch(() => {});
    }

    const firstRespTrack = await recordAssignedFirstResponse({
      conversationId: id,
      responderId: user.id,
      responderName: user.name,
      responderTeamId: cRow.assigned_team_id
        ? String(cRow.assigned_team_id)
        : "team_sales",
      responderTeamName:
        cRow.assigned_team_name &&
        String(cRow.assigned_team_name) !== "System (ACRIO)"
          ? String(cRow.assigned_team_name)
          : "Sales Team",
      messageId: msgId,
      respondedAt: nowIso,
      overrideWaitSeconds: responseSeconds,
    });
    if (responseSeconds === null && firstRespTrack?.firstResponseSeconds) {
      await conv.execute({
        sql: `UPDATE conversations SET last_response_seconds = ? WHERE id = ?`,
        args: [firstRespTrack.firstResponseSeconds, id],
      });
    }

    if (sendRes.ok && isTemplate) {
      await recordDualPricingLedgerEntry({
        messageId: msgId,
        conversationId: id,
        customerPhone,
        category: templateBillingCategory,
        staffName: user.name,
      });
    }

    if (sendRes.ok && sendRes.mode === "SANDBOX_SIMULATOR") {
      scheduleSandboxDeliveryReceipt({
        conversationId: id,
        messageId: msgId,
        waMessageId: sendRes.waMessageId,
      });
    }

    socketHub.emit("message:new", { conversationId: id, senderName: user.name, text });
    return NextResponse.json({
      ok: sendRes.ok,
      messageId: msgId,
      waMessageId: sendRes.waMessageId,
      deliveryStatus: sendRes.deliveryStatus,
      mode: sendRes.mode,
      billed: sendRes.ok && isTemplate,
      replyTo: replyMeta,
      error: sendRes.error,
    });
  }

  // 1b. Simulate Customer Read Receipt (marks all prior outbound messages in this thread as READ)
  if (action === "simulate_customer_read") {
    const updatedCount = await markPriorOutboundMessagesRead(id);
    return NextResponse.json({ ok: true, updatedCount });
  }

  // 2. Private Internal Team Note (never sent to customer, ₹0.00 Free, keeps wait timer intact)
  if (action === "add_internal_note") {
    const noteText = String(body.noteText || body.text || "").trim();
    if (!noteText) {
      return NextResponse.json({ ok: false, error: "Internal note cannot be empty." }, { status: 400 });
    }

    const replyMeta = await resolveQuotedReply();
    const metadataJson = JSON.stringify(replyMeta ? { replyTo: replyMeta } : {});
    const noteId = `msg_note_${crypto.randomUUID().slice(0, 8)}`;
    await conv.execute({
      sql: `INSERT INTO messages (
        id, conversation_id, direction, sender_type, sender_name, message_type,
        billing_category, body, metadata_json, delivery_status, created_at
      ) VALUES (?, ?, 'INTERNAL', 'STAFF_NOTE', ?, 'INTERNAL_NOTE', 'INTERNAL', ?, ?, 'SAVED', ?)`,
      args: [noteId, id, user.name, noteText, metadataJson, nowIso],
    });

    socketHub.emit("note:new", { conversationId: id, senderName: user.name, noteText });

    // @mentions ping teammates; "@ACRIO" makes ACRIO answer back in a private note.
    let mentioned: { id: string; name: string }[] = [];
    let askedAcrio = false;
    if (noteText.includes("@")) {
      try {
        const accounts = await listAllStaffAccounts();
        const staff = accounts
          .filter((a) => a.status === "ACTIVE" && a.role !== "CLIENT")
          .map((a) => ({ id: a.id, name: a.name, email: a.email }));
        const processed = await processStaffNote({
          conversationId: id,
          noteId,
          noteText,
          author: { id: user.id, name: user.name },
          staff,
        });
        mentioned = processed.mentioned;
        askedAcrio = processed.askedAcrio;
      } catch (err) {
        console.warn("[notes] mention processing failed:", (err as Error)?.message || err);
      }
    }
    return NextResponse.json({ ok: true, noteId, replyTo: replyMeta, mentioned, askedAcrio });
  }

  // 2b. Human Staff Takes Over Chat from ACRIO (defaults to Sales Team)
  if (action === "take_over_from_acrio") {
    const tailMsgRes = await conv.execute({
      sql: `SELECT direction FROM messages
            WHERE conversation_id = ? AND direction IN ('INBOUND', 'OUTBOUND')
            ORDER BY created_at DESC LIMIT 1`,
      args: [id],
    });
    const isAwaitingReply =
      tailMsgRes.rows[0] && String(tailMsgRes.rows[0].direction) === "INBOUND";

    await conv.execute({
      sql: `UPDATE conversations
            SET status = 'ASSIGNED',
                assigned_staff_id = ?,
                assigned_staff_name = ?,
                assigned_team_id = 'team_sales',
                assigned_team_name = 'Sales Team',
                escalation_level = 'P0',
                waiting_since = CASE WHEN ? = 1 THEN COALESCE(waiting_since, ?) ELSE NULL END
            WHERE id = ?`,
      args: [user.id, user.name, isAwaitingReply ? 1 : 0, nowIso, id],
    });

    await logConversationAssignment({
      conversationId: id,
      customerPhone,
      customerName: String(cRow.customer_name || ""),
      fromStaffId: cRow.assigned_staff_id ? String(cRow.assigned_staff_id) : "ACRIO",
      fromStaffName: cRow.assigned_staff_name ? String(cRow.assigned_staff_name) : "ACRIO",
      fromTeamName: cRow.assigned_team_name
        ? String(cRow.assigned_team_name)
        : "System (ACRIO)",
      toStaffId: user.id,
      toStaffName: user.name,
      toTeamId: "team_sales",
      toTeamName: "Sales Team",
      escalationLevel: "P0",
      assignmentSource: "STAFF_TAKEOVER",
      assignedByName: user.name,
      reason: "Staff took over chat from System (ACRIO)",
      assignedAt: nowIso,
    });

    socketHub.emit("conversation:assigned", {
      conversationId: id,
      staffName: user.name,
      teamName: "Sales Team",
      escalationLevel: "P0",
    });
    return NextResponse.json({ ok: true });
  }

  // 2c. Agent Assigns Chat to System (ACRIO)
  if (action === "return_to_acrio" || (action === "assign_staff" && body.staffId === "ACRIO")) {
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
      args: [id],
    });

    await logConversationAssignment({
      conversationId: id,
      customerPhone,
      customerName: String(cRow.customer_name || ""),
      fromStaffId: cRow.assigned_staff_id ? String(cRow.assigned_staff_id) : null,
      fromStaffName: cRow.assigned_staff_name ? String(cRow.assigned_staff_name) : null,
      fromTeamName: cRow.assigned_team_name ? String(cRow.assigned_team_name) : null,
      toStaffId: "ACRIO",
      toStaffName: "ACRIO",
      toTeamId: null,
      toTeamName: "System (ACRIO)",
      escalationLevel: "P0",
      assignmentSource: "RETURN_TO_SYSTEM",
      assignedByName: user.name,
      reason: `${user.name} assigned chat to System (ACRIO)`,
      assignedAt: nowIso,
    });

    // Only run ACRIO immediately if the customer's latest non-note message is still unanswered (INBOUND).
    // Otherwise, save AI credits & ₹0.30 bills and wait until the customer sends a new message!
    const lastCustOrStaffMsg = await conv.execute({
      sql: `SELECT direction, body FROM messages
            WHERE conversation_id = ? AND direction IN ('INBOUND', 'OUTBOUND')
            ORDER BY created_at DESC LIMIT 1`,
      args: [id],
    });
    const tailMsg = lastCustOrStaffMsg.rows[0];
    if (tailMsg && String(tailMsg.direction) === "INBOUND") {
      await processInboundAutomations({
        conversationId: id,
        customerPhone,
        inboundText: String(tailMsg.body || ""),
        isNewConversation: false,
      });
    }

    socketHub.emit("conversation:assigned", {
      conversationId: id,
      staffName: "ACRIO",
      teamName: "System (ACRIO)",
      escalationLevel: "P0",
    });
    return NextResponse.json({ ok: true });
  }

  // 3. Smart Team & Least-Loaded Agent Assignment (Defaults to Sales Team!)
  if (action === "smart_assign") {
    const res = await smartAssignConversation({
      conversationId: id,
      preferredTeamId: body.teamId ? String(body.teamId) : "team_sales",
      preferredTier:
        body.tier === "P1" || body.tier === "P2" ? body.tier : "P0",
      onlyIfUnassigned: false,
      triggeredByName: user.name,
    });
    return NextResponse.json({ ok: true, assignment: res });
  }

  // 4. Manual Team / Agent / Escalation Tier Assignment
  if (action === "assign_staff") {
    const staffId = body.staffId ? String(body.staffId) : user.id;
    let staffName = body.staffName ? String(body.staffName) : user.name;

    if (staffId && staffId !== "ACRIO") {
      const auth = getRawLibSqlClient("core_auth");
      const targetUserRes = await auth.execute({
        sql: `SELECT id, name, role, status FROM users WHERE id = ? LIMIT 1`,
        args: [staffId],
      });
      const targetUser = targetUserRes.rows[0] as Record<string, unknown> | undefined;
      if (targetUser) {
        staffName = String(targetUser.name || staffName);
        if (
          String(targetUser.role) === "DEV" &&
          staffId !== user.id &&
          !canAssignToDev(user.role)
        ) {
          return NextResponse.json(
            {
              ok: false,
              error:
                "Only Managers and Superadmins can assign a chat to a Dev account.",
            },
            { status: 403 }
          );
        }
      }
    }
    const teamId =
      body.teamId !== undefined
        ? body.teamId
          ? String(body.teamId)
          : null
        : cRow.assigned_team_id
        ? String(cRow.assigned_team_id)
        : "team_sales";
    const teamName =
      body.teamName !== undefined
        ? body.teamName
          ? String(body.teamName)
          : null
        : cRow.assigned_team_name &&
            String(cRow.assigned_team_name) !== "ACRIO Assistant" &&
            String(cRow.assigned_team_name) !== "System (ACRIO)"
        ? String(cRow.assigned_team_name)
        : "Sales Team";
    const escalationLevel =
      body.escalationLevel === "P1" || body.escalationLevel === "P2"
        ? body.escalationLevel
        : "P0";

    const tailMsgRes = await conv.execute({
      sql: `SELECT direction FROM messages
            WHERE conversation_id = ? AND direction IN ('INBOUND', 'OUTBOUND')
            ORDER BY created_at DESC LIMIT 1`,
      args: [id],
    });
    const isAwaitingReply =
      tailMsgRes.rows[0] && String(tailMsgRes.rows[0].direction) === "INBOUND";

    await conv.execute({
      sql: `UPDATE conversations
            SET assigned_staff_id = ?,
                assigned_staff_name = ?,
                assigned_team_id = ?,
                assigned_team_name = ?,
                escalation_level = ?,
                waiting_since = CASE WHEN ? = 1 THEN COALESCE(waiting_since, ?) ELSE waiting_since END,
                status = 'ASSIGNED'
            WHERE id = ?`,
      args: [
        staffId,
        staffName,
        teamId,
        teamName,
        escalationLevel,
        isAwaitingReply ? 1 : 0,
        nowIso,
        id,
      ],
    });

    await logConversationAssignment({
      conversationId: id,
      customerPhone,
      customerName: String(cRow.customer_name || ""),
      fromStaffId: cRow.assigned_staff_id ? String(cRow.assigned_staff_id) : null,
      fromStaffName: cRow.assigned_staff_name ? String(cRow.assigned_staff_name) : null,
      fromTeamName: cRow.assigned_team_name ? String(cRow.assigned_team_name) : null,
      toStaffId: staffId,
      toStaffName: staffName,
      toTeamId: teamId,
      toTeamName: teamName || "Sales Team",
      escalationLevel,
      assignmentSource: "MANUAL_ASSIGN",
      assignedByName: user.name,
      reason: `Assigned by ${user.name}`,
      assignedAt: nowIso,
    });

    if (staffId && staffId !== "ACRIO" && staffId !== user.id) {
      sendStaffAssignmentEmailNotification({
        staffId,
        staffName,
        customerName: String(cRow.customer_name || customerPhone),
        customerPhone,
        smartCategory: String(cRow.smart_category || "General Enquiry"),
        priority: String(cRow.priority || "NORMAL"),
        escalationLevel,
        teamName: teamName || "Sales Team",
        reason: `Assigned to you by ${user.name}`,
        latestMessage: String(cRow.last_message_preview || ""),
        conversationId: id,
      }).catch(() => {});
    }

    socketHub.emit("conversation:assigned", {
      conversationId: id,
      staffName,
      teamName,
      escalationLevel,
    });
    return NextResponse.json({ ok: true });
  }

  // 5. Smart Resolve
  if (action === "smart_resolve") {
    const summary = String(body.resolutionSummary || "Resolved customer enquiry.").trim();
    const nextCategory = body.smartCategory ? String(body.smartCategory) : String(cRow.smart_category);

    await conv.execute({
      sql: `UPDATE conversations
            SET status = 'RESOLVED',
                waiting_since = NULL,
                escalation_level = 'P0',
                smart_category = ?,
                resolution_summary = ?,
                resolved_by_id = ?,
                resolved_by_name = ?,
                resolved_at = ?
            WHERE id = ?`,
      args: [nextCategory, summary, user.id, user.name, nowIso, id],
    });

    await closeActiveAssignmentOnResolve(id, nowIso);

    if (cRow.customer_id) {
      await crm.execute({
        sql: `INSERT INTO customer_relations (
          id, customer_id, customer_phone, relation_type, summary, handled_by, occurred_at
        ) VALUES (?, ?, ?, 'WHATSAPP_RESOLVED', ?, ?, ?)`,
        args: [
          `rel_${crypto.randomUUID().slice(0, 8)}`,
          String(cRow.customer_id),
          customerPhone,
          summary,
          user.name,
          nowIso,
        ],
      });
    }

    socketHub.emit("conversation:resolved", { conversationId: id, resolvedBy: user.name });
    return NextResponse.json({ ok: true });
  }

  if (action === "reopen") {
    await conv.execute({
      sql: `UPDATE conversations
            SET status = 'ASSIGNED',
                assigned_staff_id = ?,
                assigned_staff_name = ?,
                assigned_team_id = 'team_sales',
                assigned_team_name = 'Sales Team',
                escalation_level = 'P0',
                waiting_since = NULL
            WHERE id = ?`,
      args: [user.id, user.name, id],
    });

    await logConversationAssignment({
      conversationId: id,
      customerPhone,
      customerName: String(cRow.customer_name || ""),
      fromStaffId: cRow.assigned_staff_id ? String(cRow.assigned_staff_id) : null,
      fromStaffName: cRow.assigned_staff_name ? String(cRow.assigned_staff_name) : null,
      fromTeamName: cRow.assigned_team_name ? String(cRow.assigned_team_name) : null,
      toStaffId: user.id,
      toStaffName: user.name,
      toTeamId: "team_sales",
      toTeamName: "Sales Team",
      escalationLevel: "P0",
      assignmentSource: "REOPEN",
      assignedByName: user.name,
      reason: `${user.name} reopened resolved chat`,
      assignedAt: nowIso,
    });
    return NextResponse.json({ ok: true });
  }

  if (action === "update_customer_profile") {
    await crm.execute({
      sql: `UPDATE customers
            SET company_name = COALESCE(?, company_name),
                organization_type = COALESCE(?, organization_type),
                city = COALESCE(?, city),
                acrio_segment = COALESCE(?, acrio_segment),
                notes = COALESCE(?, notes),
                last_interaction_at = ?
            WHERE phone = ?`,
      args: [
        body.companyName ?? null,
        body.organizationType ?? null,
        body.city ?? null,
        body.acrioSegment ?? null,
        body.notes ?? null,
        nowIso,
        customerPhone,
      ],
    });
    await upsertSyncedContact({
      phone: customerPhone,
      companyName: body.companyName !== undefined ? String(body.companyName || "") : undefined,
      organizationType:
        body.organizationType !== undefined ? String(body.organizationType || "") : undefined,
      city: body.city !== undefined ? String(body.city || "") : undefined,
      acrioSegment: body.acrioSegment !== undefined ? String(body.acrioSegment || "") : undefined,
      notes: body.notes !== undefined ? String(body.notes || "") : undefined,
      lastContactedAt: nowIso,
    }).catch(() => {});
    return NextResponse.json({ ok: true });
  }

  if (action === "add_order") {
    const custRes = await crm.execute({
      sql: `SELECT id, lifetime_value_inr, total_orders_count FROM customers WHERE phone = ? LIMIT 1`,
      args: [customerPhone],
    });
    const custId = custRes.rows[0] ? String(custRes.rows[0].id) : `cust_${crypto.randomUUID().slice(0, 6)}`;
    const prevLtv = custRes.rows[0] ? Number(custRes.rows[0].lifetime_value_inr ?? 0) : 0;
    const prevOrders = custRes.rows[0] ? Number(custRes.rows[0].total_orders_count ?? 0) : 0;
    const amount = Number(body.totalAmountInr || 0);
    const orderNumber =
      String(body.orderNumber || "").trim() ||
      `CC-2026-${Math.floor(1100 + Math.random() * 8900)}`;

    await crm.batch(
      [
        {
          sql: `INSERT INTO customer_orders (
            id, order_number, customer_id, customer_phone, items_summary, quantity,
            total_amount_inr, payment_status, fulfillment_status, ordered_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [
            `ord_${crypto.randomUUID().slice(0, 8)}`,
            orderNumber,
            custId,
            customerPhone,
            String(body.itemsSummary || "Custom Acrylic Order"),
            Number(body.quantity || 1),
            amount,
            String(body.paymentStatus || "ADVANCE_PAID"),
            String(body.fulfillmentStatus || "IN_PRODUCTION"),
            nowIso,
          ],
        },
        {
          sql: `UPDATE customers
                SET lifetime_value_inr = lifetime_value_inr + ?,
                    total_orders_count = total_orders_count + 1,
                    last_interaction_at = ?
                WHERE phone = ?`,
          args: [amount, nowIso, customerPhone],
        },
      ],
      "write"
    );
    const nextOrders = prevOrders + 1;
    const nextLtv = prevLtv + amount;
    await upsertSyncedContact({
      phone: customerPhone,
      lifetimeValueInr: nextLtv,
      totalOrdersCount: nextOrders,
      stage: nextLtv >= 50000 || nextOrders >= 3 ? "VIP" : nextOrders >= 2 ? "REPEAT_BUYER" : "CUSTOMER",
      lastContactedAt: nowIso,
    }).catch(() => {});
    return NextResponse.json({ ok: true, orderNumber });
  }

  // Dynamically create/update track.ccapl.cc/{id} and optionally send interactive Track Order button in chat
  if (action === "save_order_tracking" || action === "send_order_tracking") {
    const upRes = await upsertOrderTracking({
      orderId: String(body.orderId || ""),
      brand: body.brand ? String(body.brand) : undefined,
      customerName: String(body.customerName || cRow.customer_name || ""),
      customerPhone,
      conversationId: id,
      itemsSummary: body.itemsSummary !== undefined ? String(body.itemsSummary) : undefined,
      providerCode: body.providerCode ? String(body.providerCode) : undefined,
      providerName: body.providerName ? String(body.providerName) : undefined,
      awbNumber: body.awbNumber !== undefined ? String(body.awbNumber) : undefined,
      providerTrackingUrl:
        body.providerTrackingUrl !== undefined ? String(body.providerTrackingUrl) : undefined,
      shipmentStatus: body.shipmentStatus
        ? (String(body.shipmentStatus) as ShipmentStatus)
        : "DISPATCHED",
      estimatedDelivery:
        body.estimatedDelivery !== undefined ? String(body.estimatedDelivery) : undefined,
      notes: body.notes !== undefined ? String(body.notes) : undefined,
      createdByName: user.name,
    });

    if (!upRes.ok || !upRes.tracking) {
      return NextResponse.json(
        { ok: false, error: upRes.error || "Could not create tracking link." },
        { status: 400 }
      );
    }

    const trk = upRes.tracking;

    if (action === "save_order_tracking") {
      return NextResponse.json({ ok: true, tracking: trk });
    }

    const buttonLabel = String(body.buttonLabel || "Track Order")
      .trim()
      .slice(0, 20) || "Track Order";
    const firstName =
      String(cRow.customer_name || "there")
        .trim()
        .split(/\s+/)[0] || "there";
    const customText = String(body.text || "").trim();
    const messageBody =
      customText ||
      `Hello ${firstName}, your ${trk.brandLabel} order ${trk.orderId} is dispatched${
        trk.providerName ? ` via ${trk.providerName}` : ""
      }${trk.awbNumber ? ` (AWB: ${trk.awbNumber})` : ""}. Tap the button below to track live delivery.`;

    const replyMeta = await resolveQuotedReply();
    const ctaButtonMeta = {
      label: buttonLabel,
      url: trk.publicTrackingUrl,
      orderId: trk.orderId,
      providerName: trk.providerName,
      awbNumber: trk.awbNumber,
    };
    const metaObj: Record<string, unknown> = { ctaButton: ctaButtonMeta };
    if (replyMeta) metaObj.replyTo = replyMeta;

    const sendRes = await sendWhatsAppCloudMessage({
      toPhone: customerPhone,
      bodyText: messageBody,
      replyToWaMessageId: replyMeta?.waMessageId || undefined,
      ctaButton: {
        label: buttonLabel,
        url: trk.publicTrackingUrl,
        footerText: `${trk.brandLabel} Dispatch`,
      },
      simulateAsyncDelivery: true,
      forceSandbox: Boolean(body.forceSandbox),
    });

    let responseSeconds: number | null =
      cRow.last_response_seconds !== null && cRow.last_response_seconds !== undefined
        ? Number(cRow.last_response_seconds)
        : null;
    if (cRow.waiting_since) {
      const waitStart = new Date(String(cRow.waiting_since)).getTime();
      if (!Number.isNaN(waitStart)) {
        responseSeconds = Math.max(1, Math.round((nowMs - waitStart) / 1000));
      }
    }

    const wasAcrioOrUnassigned =
      !cRow.assigned_staff_id || String(cRow.assigned_staff_id) === "ACRIO";
    const shouldAutoAssignSender =
      wasAcrioOrUnassigned ||
      (isDevRole(user.role) && String(cRow.assigned_staff_id || "") !== user.id);

    const msgId = `msg_${crypto.randomUUID().slice(0, 8)}`;
    await conv.batch(
      [
        {
          sql: `INSERT INTO messages (
            id, conversation_id, direction, sender_type, sender_name, message_type,
            billing_category, body, metadata_json, wa_message_id, delivery_status, created_at
          ) VALUES (?, ?, 'OUTBOUND', 'STAFF', ?, 'CUSTOM_LINK', 'FREE_CHAT', ?, ?, ?, ?, ?)`,
          args: [
            msgId,
            id,
            user.name,
            messageBody,
            JSON.stringify(metaObj),
            sendRes.waMessageId,
            sendRes.deliveryStatus,
            nowIso,
          ],
        },
        {
          sql: `UPDATE conversations
                SET status = 'ASSIGNED',
                    assigned_staff_id = CASE WHEN ? = 1 THEN ? ELSE assigned_staff_id END,
                    assigned_staff_name = CASE WHEN ? = 1 THEN ? ELSE assigned_staff_name END,
                    assigned_team_id = CASE WHEN ? = 1 THEN COALESCE(assigned_team_id, 'team_sales') ELSE assigned_team_id END,
                    assigned_team_name = CASE
                      WHEN ? = 1 AND (assigned_team_id IS NULL OR assigned_team_name = 'System (ACRIO)') THEN 'Sales Team'
                      ELSE assigned_team_name
                    END,
                    waiting_since = NULL,
                    last_response_seconds = ?,
                    escalation_level = 'P0',
                    last_message_preview = ?,
                    last_message_at = ?
                WHERE id = ?`,
          args: [
            shouldAutoAssignSender ? 1 : 0,
            user.id,
            shouldAutoAssignSender ? 1 : 0,
            user.name,
            shouldAutoAssignSender ? 1 : 0,
            shouldAutoAssignSender ? 1 : 0,
            responseSeconds,
            `[${buttonLabel}] ${messageBody}`.replace(/\s*\n+\s*/g, " ").slice(0, 140),
            nowIso,
            id,
          ],
        },
      ],
      "write"
    );

    await recordAssignedFirstResponse({
      conversationId: id,
      responderId: user.id,
      responderName: user.name,
      responderTeamId: cRow.assigned_team_id
        ? String(cRow.assigned_team_id)
        : "team_sales",
      responderTeamName:
        cRow.assigned_team_name &&
        String(cRow.assigned_team_name) !== "System (ACRIO)"
          ? String(cRow.assigned_team_name)
          : "Sales Team",
      messageId: msgId,
      respondedAt: nowIso,
      overrideWaitSeconds: responseSeconds,
    }).catch(() => null);

    if (sendRes.ok && sendRes.mode === "SANDBOX_SIMULATOR") {
      scheduleSandboxDeliveryReceipt({
        conversationId: id,
        messageId: msgId,
        waMessageId: sendRes.waMessageId,
      });
    }

    socketHub.emit("message:new", {
      conversationId: id,
      senderName: user.name,
      text: messageBody,
    });

    return NextResponse.json({
      ok: sendRes.ok,
      tracking: trk,
      messageId: msgId,
      waMessageId: sendRes.waMessageId,
      deliveryStatus: sendRes.deliveryStatus,
      mode: sendRes.mode,
      ctaButton: ctaButtonMeta,
      error: sendRes.error,
    });
  }

  return NextResponse.json({ ok: false, error: "Unsupported action" }, { status: 400 });
}
