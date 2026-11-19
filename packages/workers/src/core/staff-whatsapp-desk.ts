import crypto from "node:crypto";
import {
  getRawLibSqlClient,
  normalizeWhatsAppPhone,
  resolveInternalStaffCallerByPhone,
} from "@cc/database";
import {
  formatWhatsAppOutboundText,
  runAcrioStaffWhatsAppAssistant,
  sendWhatsAppCloudMessage,
} from "@cc/connections";
import { socketHub } from "@cc/sockets";
import {
  assignLeadFromOwner,
  buildOwnerStaffProfile,
  flushPendingLeadForwards,
  handleOwnerDeskMessage,
  handleStaffDeskMessage,
  isOwnerWhatsAppPhone,
  isStaffGreeting,
  parseAssignCommand,
} from "@cc/workers/owner-desk";
import { logConversationAssignment } from "./assignment-tracking";

/**
 * Internal Staff Identification & Personalized Staff WhatsApp Desk.
 * Checks both `core_auth.users.whatsapp_number` and `classicconcepts.in` team numbers.
 * Returns true if the caller is an internal staff member or owner and the turn was handled.
 */
export async function handleInternalStaffInbound(params: {
  conversationId: string;
  customerPhone: string;
  workingInboundText: string;
  isButtonClick?: boolean;
  buttonPayload?: string;
  buttonText?: string;
  replyToWaMessageId?: string;
  waMessageId?: string;
  hasAttachment: boolean;
  nowIso: string;
}): Promise<boolean> {
  const conv = getRawLibSqlClient("conversations");
  const crm = getRawLibSqlClient("crm_orders");
  const isOwnerCaller = isOwnerWhatsAppPhone(params.customerPhone);
  const linkedInternalStaff = await resolveInternalStaffCallerByPhone(params.customerPhone).catch(
    () => null
  );
  // The owner is always treated as internal, even if his number is not linked to a hub login.
  const internalStaff =
    linkedInternalStaff ?? (isOwnerCaller ? buildOwnerStaffProfile(params.customerPhone) : null);

  if (!internalStaff) {
    return false;
  }

  const lower = params.workingInboundText.toLowerCase().trim();

  // Ensure internal teammate chats are labeled cleanly & never counted as waiting customer SLAs
  await conv
    .execute({
      sql: `UPDATE conversations
            SET customer_name = CASE
                  WHEN customer_name LIKE '+%' OR TRIM(customer_name) = '' THEN ?
                  ELSE customer_name
                END,
                smart_category = 'Internal Team',
                assigned_staff_id = 'ACRIO',
                assigned_staff_name = 'ACRIO',
                assigned_team_id = NULL,
                assigned_team_name = 'Internal Team Desk',
                waiting_since = NULL,
                unread_count = 0
            WHERE id = ?`,
      args: [`${internalStaff.name} (Team)`, params.conversationId],
    })
    .catch(() => {});

  const incomingBtnText = String(
    params.buttonText || params.buttonPayload || params.workingInboundText || ""
  ).trim();
  const hubBase = process.env.NEXT_PUBLIC_APP_URL || "https://whatsapp.ccapl.cc";

  const sendStaffReply = async (rawBody: string) => {
    const formatted = formatWhatsAppOutboundText(rawBody);
    const outRes = await sendWhatsAppCloudMessage({
      toPhone: params.customerPhone,
      bodyText: formatted,
      simulateAsyncDelivery: true,
    }).catch(() => ({ ok: false, waMessageId: "", deliveryStatus: "FAILED" }));
    const outId = `msg_staffwa_${crypto.randomUUID().slice(0, 8)}`;
    await conv
      .execute({
        sql: `INSERT INTO messages (
          id, conversation_id, direction, sender_type, sender_name, message_type,
          billing_category, body, wa_message_id, delivery_status, created_at
        ) VALUES (?, ?, 'OUTBOUND', 'ACRIO', 'ACRIO • Staff Desk', 'TEXT', 'ACRIO', ?, ?, ?, ?)`,
        args: [
          outId,
          params.conversationId,
          formatted,
          outRes.waMessageId || "",
          outRes.deliveryStatus || "SENT",
          new Date().toISOString(),
        ],
      })
      .catch(() => {});
    await conv
      .execute({
        sql: `UPDATE conversations SET last_message_preview = ?, last_message_at = ?, waiting_since = NULL WHERE id = ?`,
        args: [formatted.slice(0, 140), new Date().toISOString(), params.conversationId],
      })
      .catch(() => {});
    socketHub.emit("message:new", {
      conversationId: params.conversationId,
      senderName: "ACRIO • Staff Desk",
      text: formatted,
    });
  };

  // Staff just messaged us, so their 24 hour window is open. Deliver any lead that was waiting on a locked chat.
  const flushLeads = () =>
    flushPendingLeadForwards({
      staffPhone: params.customerPhone,
      conversationId: params.conversationId,
    }).catch((err) => {
      console.warn("[owner-desk] pending lead delivery failed:", err);
      return 0;
    });
  if (!isStaffGreeting(params.workingInboundText)) {
    await flushLeads();
  }

  // Template quick-reply button taps AND typed first-come, first-serve confirmations ("confirm", "accept", "claim")
  const isClaimConfirmationCmd =
    /^(Accept Assignment|Accept Callback|Accept|Claim|Confirm)$/i.test(incomingBtnText) ||
    /^(confirm|confirmed|accept|accepted|claim|take it|i'?ll take it|pick up|mine|ok confirm|yes confirm|yes accept)\W*$/i.test(
      incomingBtnText
    );

  if (
    isClaimConfirmationCmd ||
    /^(View Client Details|Snooze 30 Minutes)$/i.test(incomingBtnText)
  ) {
    let targetPhoneFromAlert = "";
    let targetCustomerNameHint = "";
    const extractPhoneFromAlertRow = (row: Record<string, unknown> | undefined) => {
      if (!row) return;
      let parsed: Record<string, unknown> = {};
      try {
        parsed = JSON.parse(String(row.metadata_json || "{}"));
      } catch {
        parsed = {};
      }
      if (parsed.alertCustomerPhone) {
        targetPhoneFromAlert = String(parsed.alertCustomerPhone);
        targetCustomerNameHint = String(parsed.alertCustomerName || "");
        return;
      }
      const bodyStr = String(row.body || "");
      const phMatch = bodyStr.match(/(?:\+?91[\s-]?)?[6-9]\d{9}/);
      if (phMatch) {
        targetPhoneFromAlert = normalizeWhatsAppPhone(phMatch[0]) || phMatch[0];
      }
    };

    if (params.replyToWaMessageId) {
      const quotedAlertRes = await conv
        .execute({
          sql: `SELECT body, metadata_json FROM messages WHERE wa_message_id = ? LIMIT 1`,
          args: [params.replyToWaMessageId],
        })
        .catch(() => ({ rows: [] as Record<string, unknown>[] }));
      extractPhoneFromAlertRow(quotedAlertRes.rows[0] as Record<string, unknown> | undefined);
    }

    if (!targetPhoneFromAlert) {
      const recentAlertsRes = await conv
        .execute({
          sql: `SELECT body, metadata_json FROM messages
                WHERE conversation_id = ? AND direction = 'OUTBOUND' AND message_type = 'TEMPLATE'
                ORDER BY created_at DESC LIMIT 5`,
          args: [params.conversationId],
        })
        .catch(() => ({ rows: [] as Record<string, unknown>[] }));
      for (const r of recentAlertsRes.rows) {
        extractPhoneFromAlertRow(r as Record<string, unknown>);
        if (targetPhoneFromAlert) break;
      }
    }

    let targetConv: Record<string, unknown> | undefined;
    if (targetPhoneFromAlert) {
      const normPhone = normalizeWhatsAppPhone(targetPhoneFromAlert) || targetPhoneFromAlert;
      const cByPhone = await conv
        .execute({
          sql: `SELECT id, customer_name, customer_phone, smart_category, last_message_preview, assigned_staff_id, assigned_staff_name, status
                FROM conversations WHERE customer_phone = ? LIMIT 1`,
          args: [normPhone],
        })
        .catch(() => ({ rows: [] as Record<string, unknown>[] }));
      targetConv = cByPhone.rows[0] as Record<string, unknown> | undefined;
    }

    if (!targetConv && internalStaff.hubUserId) {
      const latestAssigned = await conv.execute({
        sql: `SELECT id, customer_name, customer_phone, smart_category, last_message_preview, assigned_staff_id, assigned_staff_name, status
              FROM conversations
              WHERE assigned_staff_id = ? AND status != 'RESOLVED'
              ORDER BY last_message_at DESC LIMIT 1`,
        args: [internalStaff.hubUserId],
      });
      targetConv = latestAssigned.rows[0] as Record<string, unknown> | undefined;
    }

    let replyText = "";
    if (isClaimConfirmationCmd) {
      if (targetConv) {
        const targetConvId = String(targetConv.id);
        const custLabel = String(
          targetConv.customer_name || targetCustomerNameHint || targetConv.customer_phone
        );
        const custPhoneLabel = String(targetConv.customer_phone || targetPhoneFromAlert);
        const curStaffId = targetConv.assigned_staff_id
          ? String(targetConv.assigned_staff_id)
          : "ACRIO";
        const curStaffName = targetConv.assigned_staff_name
          ? String(targetConv.assigned_staff_name)
          : "ACRIO";
        const claimantId = internalStaff.hubUserId || "";
        const claimantName = internalStaff.name;

        if (!claimantId) {
          replyText = `Thanks ${internalStaff.firstName}! Your hub login account is needed to lock assignments. Open Inbox to claim: ${hubBase}/dashboard/inbox?chat=${encodeURIComponent(targetConvId)}`;
        } else if (curStaffId && curStaffId !== "ACRIO" && curStaffId !== claimantId) {
          replyText = `Already claimed, ${internalStaff.firstName}! *${custLabel}* (${custPhoneLabel}) has already been accepted by *${curStaffName}* (first-come, first-serve).\n\nView queue: ${hubBase}/dashboard/inbox`;
        } else if (curStaffId === claimantId) {
          await conv
            .execute({
              sql: `INSERT INTO messages (id, conversation_id, direction, sender_type, sender_name, message_type, billing_category, body, delivery_status, created_at)
                    VALUES (?, ?, 'INTERNAL', 'STAFF_NOTE', ?, 'INTERNAL_NOTE', 'INTERNAL', ?, 'SAVED', ?)`,
              args: [
                `msg_ack_${crypto.randomUUID().slice(0, 8)}`,
                targetConvId,
                claimantName,
                `${claimantName} confirmed assignment via WhatsApp.`,
                params.nowIso,
              ],
            })
            .catch(() => {});
          replyText = `Confirmed, ${internalStaff.firstName}! *${custLabel}* (${custPhoneLabel}) is assigned to you.\n\nOpen chat: ${hubBase}/dashboard/inbox?chat=${encodeURIComponent(targetConvId)}`;
        } else {
          // Atomic first-come, first-serve claim
          const atomicClaim = await conv.execute({
            sql: `UPDATE conversations
                  SET status = 'ASSIGNED',
                      assigned_staff_id = ?,
                      assigned_staff_name = ?,
                      assigned_team_id = COALESCE(assigned_team_id, 'team_sales'),
                      assigned_team_name = CASE
                        WHEN assigned_team_name IS NULL OR TRIM(assigned_team_name) = '' OR assigned_team_name LIKE 'System (ACRIO)%' OR assigned_team_name = 'ACRIO Assistant' OR assigned_team_name = 'Internal Team Desk'
                        THEN 'Sales Team'
                        ELSE assigned_team_name
                      END,
                      escalation_level = 'P0',
                      waiting_since = NULL
                  WHERE id = ?
                    AND (assigned_staff_id IS NULL OR TRIM(assigned_staff_id) = '' OR assigned_staff_id = 'ACRIO')`,
            args: [claimantId, claimantName, targetConvId],
          });
          if (Number(atomicClaim.rowsAffected ?? 0) === 1) {
            await logConversationAssignment({
              conversationId: targetConvId,
              customerPhone: custPhoneLabel,
              customerName: custLabel,
              fromStaffId: "ACRIO",
              fromStaffName: "ACRIO",
              fromTeamName: "System (ACRIO)",
              toStaffId: claimantId,
              toStaffName: claimantName,
              toTeamId: "team_sales",
              toTeamName: "Sales Team",
              escalationLevel: "P0",
              assignmentSource: "WHATSAPP_FIRST_COME_CLAIM",
              assignedByName: claimantName,
              reason: `${claimantName} accepted first via WhatsApp confirmation`,
              assignedAt: params.nowIso,
            }).catch(() => {});
            await conv
              .execute({
                sql: `INSERT INTO messages (id, conversation_id, direction, sender_type, sender_name, message_type, billing_category, body, delivery_status, created_at)
                      VALUES (?, ?, 'INTERNAL', 'STAFF_NOTE', ?, 'INTERNAL_NOTE', 'INTERNAL', ?, 'SAVED', ?)`,
                args: [
                  `msg_ack_${crypto.randomUUID().slice(0, 8)}`,
                  targetConvId,
                  claimantName,
                  `${claimantName} accepted and claimed this chat first via WhatsApp.`,
                  params.nowIso,
                ],
              })
              .catch(() => {});
            socketHub.emit("conversation:assigned", {
              conversationId: targetConvId,
              staffId: claimantId,
              staffName: claimantName,
              teamName: "Sales Team",
              escalationLevel: "P0",
            });
            replyText = `Confirmed, ${internalStaff.firstName}! You claimed *${custLabel}* (${custPhoneLabel}) first and it is now assigned to you.\n\nOpen chat: ${hubBase}/dashboard/inbox?chat=${encodeURIComponent(targetConvId)}`;
          } else {
            const winnerRes = await conv.execute({
              sql: `SELECT assigned_staff_name FROM conversations WHERE id = ? LIMIT 1`,
              args: [targetConvId],
            });
            const winnerName = String(winnerRes.rows[0]?.assigned_staff_name || "another team member");
            replyText = `Already claimed, ${internalStaff.firstName}! *${custLabel}* (${custPhoneLabel}) was just accepted by *${winnerName}* (first-come, first-serve).\n\nView queue: ${hubBase}/dashboard/inbox`;
          }
        }
      } else {
        replyText = `Thanks ${internalStaff.firstName}! View your open queue here: ${hubBase}/dashboard/inbox`;
      }
    } else if (/View Client Details/i.test(incomingBtnText)) {
      replyText = targetConv
        ? `*Latest Assigned Client:*\n• *Name:* ${String(targetConv.customer_name || "Customer")}\n• *Phone:* ${String(targetConv.customer_phone)}\n• *Topic:* ${String(targetConv.smart_category || "General Enquiry")}\n• *Last message:* ${String(targetConv.last_message_preview || "")}\n\nOpen chat: ${hubBase}/dashboard/inbox?chat=${encodeURIComponent(String(targetConv.id))}`
        : `No open client chat is waiting for you right now, ${internalStaff.firstName}. Inbox: ${hubBase}/dashboard/inbox`;
    } else {
      replyText = `Alert snoozed for 30 minutes, ${internalStaff.firstName}. Open queue anytime: ${hubBase}/dashboard/inbox`;
    }
    await sendStaffReply(replyText);
    return true;
  }

  // Owner & Staff-to-Staff lead forwarding: "assign", "assign to @staff", "forward to @staff", swipe-reply takeovers, and owner read-only commands.
  if (!params.isButtonClick) {
    if (isOwnerCaller) {
      const ownerHandled = await handleOwnerDeskMessage({
        conversationId: params.conversationId,
        ownerPhone: params.customerPhone,
        text: params.workingInboundText,
        currentWaMessageId: params.waMessageId,
        replyToWaMessageId: params.replyToWaMessageId,
        hasAttachment: params.hasAttachment,
        hubBase,
        logAssignment: logConversationAssignment,
        reply: sendStaffReply,
      }).catch(async (err) => {
        console.error("[owner-desk] owner command failed:", err);
        await sendStaffReply(
          "Sorry sir, something went wrong while handling that. Nothing was lost. Please try again in a moment."
        ).catch(() => {});
        return true;
      });
      if (ownerHandled) return true;
    } else {
      const staffAssignCmd = parseAssignCommand(params.workingInboundText);
      if (staffAssignCmd.found) {
        const fwdRes = await assignLeadFromOwner(staffAssignCmd, {
          conversationId: params.conversationId,
          ownerPhone: params.customerPhone,
          ownerName: internalStaff.name,
          text: params.workingInboundText,
          currentWaMessageId: params.waMessageId,
          replyToWaMessageId: params.replyToWaMessageId,
          hubBase,
          logAssignment: logConversationAssignment,
          isStaffForwarder: true,
        }).catch(async (err) => {
          console.error("[staff-lead-forward] failed:", err);
          return {
            handled: true,
            reply: `Sorry ${internalStaff.firstName}, I could not forward that lead right now. Please try again or use MY LEADS in the hub.`,
          };
        });
        if (fwdRes.handled) {
          await sendStaffReply(fwdRes.reply);
          return true;
        }
      }
    }
  }

  // Staff desk: "hi" unlocks the chat, "my leads" lists forwarded leads.
  if (!params.isButtonClick) {
    const staffHandled = await handleStaffDeskMessage({
      staff: internalStaff,
      text: params.workingInboundText,
      hubBase,
      flushLeads,
      reply: sendStaffReply,
    }).catch(() => false);
    if (staffHandled) return true;
  }

  // Fast personalized internal shortcuts: "my chats", "callbacks", "stats", or "check <phone>"
  if (/^(?:my\s*(?:chats?|leads?|open\s*chats?|assigned|queue)|open\s*leads?)\W*$/i.test(lower)) {
    const assignedRows = internalStaff.hubUserId
      ? await conv.execute({
          sql: `SELECT id, customer_name, customer_phone, smart_category, last_message_preview
                FROM conversations
                WHERE (assigned_staff_id = ? OR collaborators_json LIKE ?) AND status != 'RESOLVED'
                ORDER BY last_message_at DESC LIMIT 6`,
          args: [internalStaff.hubUserId, `%"staffId":"${internalStaff.hubUserId}"%`],
        })
      : { rows: [] as Record<string, unknown>[] };
    if (assignedRows.rows.length === 0) {
      await sendStaffReply(
        `Hey *${internalStaff.firstName}*! You have *0 open assigned chats* right now.\n\nCheck open pool or call queue: ${hubBase}/dashboard/inbox`
      );
    } else {
      const items = assignedRows.rows
        .map(
          (r, i) =>
            `${i + 1}. *${String(r.customer_name || r.customer_phone)}* (${String(r.customer_phone)})\n   Topic: ${String(r.smart_category || "Enquiry")} | ${hubBase}/dashboard/inbox?chat=${encodeURIComponent(String(r.id))}`
        )
        .join("\n\n");
      await sendStaffReply(
        `Hey *${internalStaff.firstName}*, here are your *${assignedRows.rows.length} open chats*:\n\n${items}`
      );
    }
    return true;
  }

  if (/^(?:callbacks?|pending\s*callbacks?|calls?)\W*$/i.test(lower)) {
    const cbRows = await conv
      .execute(
        `SELECT conversation_id, customer_name, customer_phone, preferred_slot, topic
         FROM callback_requests WHERE status = 'PENDING' ORDER BY created_at DESC LIMIT 6`
      )
      .catch(() => ({ rows: [] as Record<string, unknown>[] }));
    if (cbRows.rows.length === 0) {
      await sendStaffReply(
        `Hey *${internalStaff.firstName}*, there are *no pending callbacks* right now! Call Queue: ${hubBase}/dashboard/call-queue`
      );
    } else {
      const list = cbRows.rows
        .map(
          (r, i) =>
            `${i + 1}. *${String(r.customer_name || r.customer_phone)}* (${String(r.customer_phone)})\n   Slot: ${String(r.preferred_slot || "ASAP")} | ${String(r.topic || "General")}\n   ${hubBase}/dashboard/inbox?chat=${encodeURIComponent(String(r.conversation_id))}`
        )
        .join("\n\n");
      await sendStaffReply(
        `Hey *${internalStaff.firstName}*, here are the *pending callbacks (${cbRows.rows.length})*:\n\n${list}`
      );
    }
    return true;
  }

  if (/^(?:stats?|summary|today|today'?s?\s*stats?)\W*$/i.test(lower)) {
    const [openCntRes, waitCntRes, cqCntRes] = await Promise.all([
      conv.execute(`SELECT COUNT(*) AS c FROM conversations WHERE status != 'RESOLVED'`),
      conv.execute(`SELECT COUNT(*) AS c FROM conversations WHERE status != 'RESOLVED' AND waiting_since IS NOT NULL`),
      conv.execute(`SELECT COUNT(*) AS c FROM call_dispatch_queue WHERE status != 'RESOLVED'`).catch(() => ({ rows: [{ c: 0 }] })),
    ]);
    await sendStaffReply(
      `*Classic Concepts Live Desk Snapshot* (for ${internalStaff.firstName}):\n\n• *Open Conversations:* ${Number(openCntRes.rows[0]?.c ?? 0)}\n• *Waiting for Staff Reply:* ${Number(waitCntRes.rows[0]?.c ?? 0)}\n• *Open Call Queue Items:* ${Number(cqCntRes.rows[0]?.c ?? 0)}\n\nOpen Dashboard: ${hubBase}/dashboard`
    );
    return true;
  }

  const phoneLookupMatch = params.workingInboundText.match(/(?:check|lookup|find|status|details|who\s+is)?\s*(\+?\d[\d\s-]{8,14}\d)/i);
  if (
    phoneLookupMatch &&
    /\b(check|lookup|find|status|details|client|customer|order|who)\b/i.test(lower)
  ) {
    const lookupDigits = phoneLookupMatch[1].replace(/\D/g, "").slice(-10);
    if (lookupDigits.length === 10) {
      const [cRes, custRes] = await Promise.all([
        conv.execute({
          sql: `SELECT id, customer_name, customer_phone, status, assigned_staff_name, smart_category, last_message_preview
                FROM conversations WHERE customer_phone LIKE ? ORDER BY last_message_at DESC LIMIT 1`,
          args: [`%${lookupDigits}%`],
        }),
        crm.execute({
          sql: `SELECT name, company_name, city, acrio_segment, total_orders_count, lifetime_value_inr
                FROM customers WHERE phone LIKE ? LIMIT 1`,
          args: [`%${lookupDigits}%`],
        }),
      ]);
      const cRowFound = cRes.rows[0];
      const custFound = custRes.rows[0];
      if (!cRowFound && !custFound) {
        await sendStaffReply(
          `Hey *${internalStaff.firstName}*, no CRM record or chat was found matching *${phoneLookupMatch[1].trim()}*.`
        );
      } else {
        await sendStaffReply(
          `*Internal CRM Lookup for ${internalStaff.firstName}:*\n• *Client:* ${String(custFound?.name || cRowFound?.customer_name || lookupDigits)}\n• *Phone:* ${String(cRowFound?.customer_phone || lookupDigits)}${custFound?.company_name ? `\n• *Company:* ${String(custFound.company_name)}` : ""}${custFound?.city ? `\n• *City:* ${String(custFound.city)}` : ""}\n• *Assigned to:* ${String(cRowFound?.assigned_staff_name || "ACRIO")}\n• *Status:* ${String(cRowFound?.status || "NEW")}\n• *Orders:* ${Number(custFound?.total_orders_count ?? 0)}${cRowFound?.id ? `\n\nOpen Chat: ${hubBase}/dashboard/inbox?chat=${encodeURIComponent(String(cRowFound.id))}` : ""}`
        );
      }
      return true;
    }
  }

  // Full personalized AI Staff Assistant on WhatsApp
  const recentStaffMsgs = await conv
    .execute({
      sql: `SELECT direction, body FROM messages WHERE conversation_id = ? AND direction IN ('INBOUND', 'OUTBOUND') ORDER BY created_at DESC LIMIT 10`,
      args: [params.conversationId],
    })
    .catch(() => ({ rows: [] as Record<string, unknown>[] }));
  const staffResult = await runAcrioStaffWhatsAppAssistant({
    staff: internalStaff,
    inboundText: params.workingInboundText,
    recentMessages: [...recentStaffMsgs.rows].reverse().map((r) => ({
      direction: String(r.direction),
      body: String(r.body || ""),
    })),
  });
  await sendStaffReply(staffResult.replyText);
  return true;
}

/**
 * Fallback handler for Meta Alert Template Quick-Reply taps when caller was not
 * already matched via internalStaff profile.
 */
export async function handleMetaAlertQuickReplyFallback(params: {
  customerPhone: string;
  incomingBtnText: string;
  nowIso: string;
}): Promise<boolean> {
  if (!/^(Accept Assignment|View Client Details|Accept Callback|Snooze 30 Minutes)$/i.test(params.incomingBtnText)) {
    return false;
  }
  const conv = getRawLibSqlClient("conversations");
  const auth = getRawLibSqlClient("core_auth");
  const digitsSuffix = params.customerPhone.replace(/\D/g, "").slice(-10);
  const staffRows =
    digitsSuffix.length >= 10
      ? await auth.execute({
          sql: `SELECT id, name, whatsapp_number FROM users WHERE status = 'ACTIVE' AND whatsapp_number IS NOT NULL AND whatsapp_number != ''`,
        })
      : { rows: [] as Record<string, unknown>[] };
  const staffCaller = staffRows.rows.find(
    (u) => String(u.whatsapp_number || "").replace(/\D/g, "").slice(-10) === digitsSuffix
  );
  if (!staffCaller) return false;

  const sId = String(staffCaller.id);
  const sName = String(staffCaller.name || "Team Member");
  const latestAssigned = await conv.execute({
    sql: `SELECT id, customer_name, customer_phone, smart_category, last_message_preview
          FROM conversations
          WHERE assigned_staff_id = ? AND status != 'RESOLVED'
          ORDER BY last_message_at DESC LIMIT 1`,
    args: [sId],
  });
  const targetConv = latestAssigned.rows[0];
  const hubBase = process.env.NEXT_PUBLIC_APP_URL || "https://whatsapp.ccapl.cc";
  let replyText = "";
  if (/Accept Assignment/i.test(params.incomingBtnText)) {
    if (targetConv) {
      await conv
        .execute({
          sql: `INSERT INTO messages (id, conversation_id, direction, sender_type, sender_name, message_type, billing_category, body, delivery_status, created_at)
                VALUES (?, ?, 'INTERNAL', 'STAFF_NOTE', ?, 'INTERNAL_NOTE', 'INTERNAL', ?, 'SAVED', ?)`,
          args: [
            `msg_ack_${crypto.randomUUID().slice(0, 8)}`,
            String(targetConv.id),
            sName,
            `${sName} accepted assignment via WhatsApp.`,
            params.nowIso,
          ],
        })
        .catch(() => {});
      replyText = `Thanks ${sName}! Confirmed your acceptance for *${String(targetConv.customer_name || targetConv.customer_phone)}*.\n\nOpen chat: ${hubBase}/dashboard/inbox?chat=${encodeURIComponent(String(targetConv.id))}`;
    } else {
      replyText = `Thanks ${sName}! Open your assigned queue here: ${hubBase}/dashboard/inbox`;
    }
  } else if (/View Client Details/i.test(params.incomingBtnText)) {
    if (targetConv) {
      replyText = `*Latest Assigned Client:*\n• *Name:* ${String(targetConv.customer_name || "Customer")}\n• *Phone:* ${String(targetConv.customer_phone)}\n• *Topic:* ${String(targetConv.smart_category || "General Enquiry")}\n• *Last msg:* ${String(targetConv.last_message_preview || "")}\n\nOpen chat: ${hubBase}/dashboard/inbox?chat=${encodeURIComponent(String(targetConv.id))}`;
    } else {
      replyText = `No open client chat is currently waiting for you. Check your inbox: ${hubBase}/dashboard/inbox`;
    }
  } else if (/Accept Callback/i.test(params.incomingBtnText)) {
    replyText = targetConv
      ? `Callback accepted! Please call *${String(targetConv.customer_name || "")}* at ${String(targetConv.customer_phone)} and log the outcome in ${hubBase}/dashboard/inbox?chat=${encodeURIComponent(String(targetConv.id))}`
      : `Callback accepted! Check pending callbacks in ${hubBase}/dashboard/inbox`;
  } else {
    replyText = `Snoozed alert for 30 minutes, ${sName}. You can still pick up the client anytime in ${hubBase}/dashboard/inbox`;
  }
  await sendWhatsAppCloudMessage({
    toPhone: params.customerPhone,
    bodyText: replyText,
    simulateAsyncDelivery: true,
  }).catch(() => {});
  return true;
}
