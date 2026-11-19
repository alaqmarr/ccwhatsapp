import crypto from "node:crypto";
import { getRawLibSqlClient } from "@cc/database";
import {
  extractQuoteRequestDetails,
  runAcrioAutonomousTurn,
  sendQuoteRequestAlertTemplate,
} from "@cc/connections";
import { socketHub } from "@cc/sockets";
import { sendAcrioChatMessage } from "./acrio-chat-sender";
import { recordAssignedFirstResponse } from "./assignment-tracking";
import {
  loadPendingInboundBurst,
  sleepMs,
  type PendingBurstAttachments,
} from "./inbound-burst";
import type { InboundAutomationParams } from "./inbound-ai-orchestrator";
import { smartAssignConversation } from "./routing-and-escalation";
import { getInboundTurnSeq } from "./webhook-idempotency";

/**
 * Executes ACRIO autonomous multi-turn AI with burst freshness gating,
 * consultative Sales Team pinging, and safe human handoff when required.
 */
export async function executeAcrioAutonomousPipeline(params: {
  inbound: InboundAutomationParams;
  convRow: Record<string, unknown>;
  workingInboundText: string;
  forcedFocusSlug?: string;
  initialLatestInboundId: string | null;
  initialBurstAttachments: PendingBurstAttachments;
  entrySeq: number;
}): Promise<void> {
  const conv = getRawLibSqlClient("conversations");
  const { inbound, convRow } = params;

  let acrioTurn!: Awaited<ReturnType<typeof runAcrioAutonomousTurn>>;
  let lastSeenInboundId = params.initialLatestInboundId;
  let activePromptText = params.workingInboundText;
  let activeBurstAttachments = params.initialBurstAttachments;

  for (let aiAttempt = 0; aiAttempt < 3; aiAttempt++) {
    const seqAtAiStart = getInboundTurnSeq(inbound.conversationId);

    const recentRes = await conv.execute({
      sql: `SELECT direction, sender_type, body, metadata_json, wa_message_id FROM messages
            WHERE conversation_id = ? AND direction IN ('INBOUND', 'OUTBOUND')
            ORDER BY created_at DESC LIMIT 16`,
      args: [inbound.conversationId],
    });
    const recentMessages = [...recentRes.rows].reverse().map((m) => {
      let parsedMeta: Record<string, any> = {};
      if (m.metadata_json) {
        try {
          parsedMeta = JSON.parse(String(m.metadata_json));
        } catch {
          parsedMeta = {};
        }
      }
      return {
        direction: String(m.direction),
        senderType: String(m.sender_type || ""),
        body: String(m.body),
        productSlug: parsedMeta.productSlug ? String(parsedMeta.productSlug) : null,
        replyTo: parsedMeta.replyTo || null,
      };
    });
    const hasAlreadyGreeted = recentMessages.some((m) => m.direction === "OUTBOUND");

    let replyToMessage = recentMessages[recentMessages.length - 1]?.replyTo || null;
    if (!replyToMessage && inbound.replyToWaMessageId) {
      const quotedRes = await conv
        .execute({
          sql: `SELECT sender_name, direction, body, metadata_json FROM messages WHERE wa_message_id = ? LIMIT 1`,
          args: [inbound.replyToWaMessageId],
        })
        .catch(() => ({ rows: [] as any[] }));
      const qRow = quotedRes.rows[0];
      if (qRow) {
        let qMeta: Record<string, any> = {};
        if (qRow.metadata_json) {
          try {
            qMeta = JSON.parse(String(qRow.metadata_json));
          } catch {
            qMeta = {};
          }
        }
        replyToMessage = {
          waMessageId: inbound.replyToWaMessageId,
          senderName: String(qRow.sender_name || "ACRIO"),
          direction: String(qRow.direction || "OUTBOUND"),
          body: String(qRow.body || ""),
          productSlug: qMeta.productSlug ? String(qMeta.productSlug) : null,
          productName: qMeta.productName ? String(qMeta.productName) : null,
          variantName: qMeta.variantName ? String(qMeta.variantName) : null,
        };
      }
    }

    acrioTurn = await runAcrioAutonomousTurn({
      conversationId: inbound.conversationId,
      customerName: String(convRow.customer_name || inbound.customerPhone),
      customerPhone: inbound.customerPhone,
      inboundText: activePromptText,
      recentMessages,
      hasAlreadyGreeted,
      forcedFocusSlug: params.forcedFocusSlug,
      replyToMessage,
      attachment: inbound.attachment || null,
      burstAttachments: activeBurstAttachments,
      visionAnalyzerOverride: inbound.visionAnalyzerOverride,
      mediaFetchImpl: inbound.mediaFetchImpl,
    });

    // Freshness gate: did the customer send another message while AI was generating this reply?
    const latestBurst = await loadPendingInboundBurst(
      inbound.conversationId,
      activePromptText
    );
    const seqMoved =
      getInboundTurnSeq(inbound.conversationId) !== seqAtAiStart ||
      getInboundTurnSeq(inbound.conversationId) !== params.entrySeq;
    const dbMoved =
      Boolean(latestBurst.latestInboundId) &&
      latestBurst.latestInboundId !== lastSeenInboundId;

    if ((seqMoved || dbMoved) && !inbound.isButtonClick) {
      if (getInboundTurnSeq(inbound.conversationId) !== params.entrySeq) {
        return;
      }
      if (aiAttempt < 2) {
        await sleepMs(850);
        const settledBurst = await loadPendingInboundBurst(
          inbound.conversationId,
          activePromptText
        );
        lastSeenInboundId = settledBurst.latestInboundId;
        activePromptText = settledBurst.coalescedText;
        activeBurstAttachments = settledBurst.burstAttachments;
        continue;
      }
    }

    break;
  }

  if (inbound.onBeforeAcrioSend) {
    await inbound.onBeforeAcrioSend();
  }

  // Re-verify conversation ownership immediately before sending ACRIO's outbound reply
  const postTurnConvRes = await conv.execute({
    sql: `SELECT status, assigned_staff_id, assigned_team_id FROM conversations WHERE id = ? LIMIT 1`,
    args: [inbound.conversationId],
  });
  const postTurnRow = (postTurnConvRes.rows[0] || {}) as Record<string, unknown>;
  const postStaffId = postTurnRow.assigned_staff_id
    ? String(postTurnRow.assigned_staff_id)
    : "";
  const postTeamId = postTurnRow.assigned_team_id
    ? String(postTurnRow.assigned_team_id)
    : "";
  const postStatus = postTurnRow.status ? String(postTurnRow.status) : "";
  const stillOwnedByAcrio =
    postStaffId === "ACRIO" &&
    postStatus !== "ASSIGNED" &&
    (!postTeamId || postTeamId === "System (ACRIO)");
  if (!stillOwnedByAcrio) {
    return;
  }

  if (!acrioTurn.needsHumanHandoff) {
    const { acrioMsgId, replyIso } = await sendAcrioChatMessage({
      conversationId: inbound.conversationId,
      customerPhone: inbound.customerPhone,
      text: acrioTurn.customerReply,
      interactive: acrioTurn.interactive,
      mediaAttachments: acrioTurn.mediaAttachments,
      locationPin: acrioTurn.locationPin,
    });

    await recordAssignedFirstResponse({
      conversationId: inbound.conversationId,
      responderId: "ACRIO",
      responderName: "ACRIO",
      responderTeamId: null,
      responderTeamName: "System (ACRIO)",
      messageId: acrioMsgId,
      respondedAt: replyIso,
    });

    const teamLabel = acrioTurn.needsSalesTeamPing
      ? "System (ACRIO) • Sales Pinged"
      : "System (ACRIO)";
    await conv.execute({
      sql: `UPDATE conversations
            SET status = 'OPEN',
                assigned_staff_id = 'ACRIO',
                assigned_staff_name = 'ACRIO',
                assigned_team_id = ?,
                assigned_team_name = ?,
                smart_category = ?,
                priority = ?,
                escalation_level = 'P0',
                waiting_since = NULL,
                unread_count = ?,
                last_message_preview = ?,
                last_message_at = ?,
                last_message_direction = 'OUTBOUND',
                last_message_status = 'SENT'
            WHERE id = ?`,
      args: [
        null,
        teamLabel,
        acrioTurn.smartCategory,
        acrioTurn.needsSalesTeamPing ? "HIGH" : acrioTurn.priority,
        acrioTurn.needsSalesTeamPing ? 1 : 0,
        `ACRIO: ${acrioTurn.customerReply}`.slice(0, 140),
        replyIso,
        inbound.conversationId,
      ],
    });

    if (acrioTurn.needsSalesTeamPing) {
      const pingMsgId = `msg_ping_${crypto.randomUUID().slice(0, 8)}`;
      const pingBody =
        acrioTurn.salesTeamPingNote ||
        `ACRIO Consultative Ping: Customer requested bulk/project pricing ("${inbound.inboundText.slice(0, 120)}"). ACRIO remains active on this chat; Sales Team can drop a single reply if special pricing applies.`;
      await conv
        .execute({
          sql: `INSERT INTO messages (
            id, conversation_id, direction, sender_type, sender_name, message_type,
            billing_category, body, delivery_status, created_at
          ) VALUES (?, ?, 'INTERNAL', 'SYSTEM', 'ACRIO • Sales Ping', 'INTERNAL_NOTE', 'FREE', ?, 'DELIVERED', ?)`,
          args: [pingMsgId, inbound.conversationId, pingBody, replyIso],
        })
        .catch(() => {});

      socketHub.emit("message:new", {
        conversationId: inbound.conversationId,
        senderName: "ACRIO • Sales Ping",
        text: pingBody,
      });

      const quoteInfo = extractQuoteRequestDetails({
        text: inbound.inboundText,
        smartCategory: acrioTurn.smartCategory,
      });
      if (quoteInfo.isQuoteRequest) {
        const assignedHumanId =
          convRow.assigned_staff_id && String(convRow.assigned_staff_id) !== "ACRIO"
            ? String(convRow.assigned_staff_id)
            : "";
        let targetStaffId = assignedHumanId;
        let targetStaffName = String(convRow.assigned_staff_name || "Sales Team");

        if (!targetStaffId) {
          const salesMembersRes = await conv
            .execute(
              `SELECT tm.staff_id, tm.staff_name,
                      (SELECT COUNT(*) FROM conversations c WHERE c.assigned_staff_id = tm.staff_id AND c.status != 'RESOLVED') AS open_cnt
               FROM team_members tm
               WHERE tm.team_id = 'team_sales' AND tm.is_available = 1
               ORDER BY tm.tier ASC, open_cnt ASC
               LIMIT 1`
            )
            .catch(() => ({ rows: [] as Record<string, unknown>[] }));
          if (salesMembersRes.rows[0]) {
            targetStaffId = String(salesMembersRes.rows[0].staff_id);
            targetStaffName = String(salesMembersRes.rows[0].staff_name || "Sales Team");
          }
        }

        if (targetStaffId) {
          void sendQuoteRequestAlertTemplate({
            staffId: targetStaffId,
            staffName: targetStaffName,
            customerName: String(convRow.customer_name || inbound.customerPhone),
            customerPhone: inbound.customerPhone,
            productName: quoteInfo.product,
            quantity: quoteInfo.quantity,
          }).catch(() => {});
        }
      }
    }

    socketHub.emit("message:new", {
      conversationId: inbound.conversationId,
      senderName: "ACRIO",
      text: acrioTurn.customerReply,
    });
    return;
  }

  // Needs human handoff -> route to staff FIRST before sending transfer confirmation
  let assigned: Awaited<ReturnType<typeof smartAssignConversation>> | null = null;
  let routingSucceeded = false;
  try {
    assigned = await smartAssignConversation({
      conversationId: inbound.conversationId,
      inboundText: inbound.inboundText,
      preferredTeamId: "team_sales",
      onlyIfUnassigned: true,
      startWaitingTimer: true,
      handoffReasonFromAcrio: acrioTurn.handoffReason,
    });
    routingSucceeded = Boolean(assigned?.assignedTeamId || assigned?.assignedStaffId);
  } catch {
    routingSucceeded = false;
  }

  const outboundHandoffText = routingSucceeded
    ? acrioTurn.customerReply
    : "I could not transfer your message to an available staff member right now. Please contact our Sales Team directly on WhatsApp at +91 73372 20568, call +91 79016 50662, or email sales@classicconcepts.in with your requirement.";

  const { acrioMsgId, replyIso } = await sendAcrioChatMessage({
    conversationId: inbound.conversationId,
    customerPhone: inbound.customerPhone,
    text: outboundHandoffText,
    interactive: routingSucceeded ? acrioTurn.interactive : undefined,
    mediaAttachments: routingSucceeded ? acrioTurn.mediaAttachments : undefined,
  });

  await recordAssignedFirstResponse({
    conversationId: inbound.conversationId,
    responderId: "ACRIO",
    responderName: "ACRIO",
    responderTeamId: null,
    responderTeamName: "System (ACRIO)",
    messageId: acrioMsgId,
    respondedAt: replyIso,
  });

  await conv.execute({
    sql: `UPDATE conversations
          SET smart_category = ?,
              priority = ?,
              last_message_preview = ?,
              last_message_at = ?
          WHERE id = ?`,
    args: [
      acrioTurn.smartCategory,
      acrioTurn.priority,
      inbound.inboundText.slice(0, 140),
      replyIso,
      inbound.conversationId,
    ],
  });

  socketHub.emit("message:new", {
    conversationId: inbound.conversationId,
    senderName: "ACRIO",
    text: outboundHandoffText,
  });

  if (routingSucceeded && assigned) {
    socketHub.emit("conversation:assigned", {
      conversationId: inbound.conversationId,
      assignedTeamName: assigned.assignedTeamName,
      assignedStaffName: assigned.assignedStaffName,
      escalationLevel: assigned.escalationLevel,
    });
  }
}
