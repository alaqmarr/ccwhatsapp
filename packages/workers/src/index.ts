import crypto from "node:crypto";
import {
  ensureDatabasesBootstrapped,
  getRawLibSqlClient,
} from "@cc/database";
import {
  executeMultiDatabaseBackup,
  runAcrioAutonomousTurn,
  sendWhatsAppCloudMessage,
} from "@cc/connections";
import {
  claimPendingJobs,
  completeJob,
  enqueueJob,
  failJob,
  recordWorkerHeartbeat,
} from "@cc/queue";
import { socketHub } from "@cc/sockets";

export type BillingMessageCategory =
  | "MARKETING"
  | "UTILITY"
  | "AUTHENTICATION"
  | "ACRIO";

/**
 * Dual-Ledger Billing Engine:
 * - Regular 24h staff chat messages are FREE (₹0.00) and never recorded here!
 * - Charged ONLY on:
 *   1. ACRIO automated replies (`ACRIO` -> ₹0.30)
 *   2. Templated messages (`MARKETING` -> ₹0.95; `UTILITY` / `AUTHENTICATION` -> ₹0.30)
 * - DEV sees actual Meta / AI cost + exact net margin per message!
 */
export async function recordDualPricingLedgerEntry(params: {
  messageId?: string;
  broadcastId?: string;
  conversationId?: string;
  customerPhone: string;
  category: BillingMessageCategory;
  staffName: string;
}): Promise<{
  clientUnitRateInr: number;
  actualMetaUnitCostInr: number;
  marginInr: number;
}> {
  await ensureDatabasesBootstrapped();
  const bill = getRawLibSqlClient("billing_ops");

  const cfgRes = await bill.execute(
    `SELECT * FROM pricing_config WHERE id = 'default' LIMIT 1`
  );
  const cfg = (cfgRes.rows[0] || {}) as Record<string, unknown>;

  const clientMarketing = Number(cfg.client_marketing_rate_inr ?? 0.95);
  const clientOther = Number(cfg.client_other_rate_inr ?? 0.3);

  const metaMarketing = Number(cfg.actual_meta_marketing_rate_inr ?? 0.7846);
  const metaUtility = Number(cfg.actual_meta_utility_rate_inr ?? 0.115);
  const metaAuth = Number(cfg.actual_meta_auth_rate_inr ?? 0.115);
  const metaAcrio = Number(cfg.actual_meta_service_rate_inr ?? 0.04);

  const clientUnitRateInr =
    params.category === "MARKETING" ? clientMarketing : clientOther;

  let actualMetaUnitCostInr = metaUtility;
  if (params.category === "MARKETING") actualMetaUnitCostInr = metaMarketing;
  else if (params.category === "AUTHENTICATION") actualMetaUnitCostInr = metaAuth;
  else if (params.category === "ACRIO") actualMetaUnitCostInr = metaAcrio;

  const marginInr = Number(
    (clientUnitRateInr - actualMetaUnitCostInr).toFixed(4)
  );

  await bill.execute({
    sql: `INSERT INTO message_billing_ledger (
      id, message_id, broadcast_id, conversation_id, customer_phone,
      category, client_unit_rate_inr, actual_meta_unit_cost_inr, margin_inr, staff_name, billed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      `ldg_${crypto.randomUUID().slice(0, 10)}`,
      params.messageId || null,
      params.broadcastId || null,
      params.conversationId || null,
      params.customerPhone,
      params.category,
      clientUnitRateInr,
      actualMetaUnitCostInr,
      marginInr,
      params.staffName,
      new Date().toISOString(),
    ],
  });

  return { clientUnitRateInr, actualMetaUnitCostInr, marginInr };
}

/**
 * Runs inbound ACRIO-first backend handling + smart tagging:
 * 1. Initial assignment is ALWAYS `ACRIO`, which answers product & machine queries automatically.
 * 2. If the customer asks to talk to support/staff OR ACRIO is unable to resolve the query,
 *    ACRIO connects the chat to human staff — defaulting ALWAYS to `Sales Team` (`P0 -> P1 -> P2`).
 * 3. If the chat was already handed over to a human staff member, ACRIO steps aside and starts
 *    the customer wait-time clock (`waiting_since`) so P0 -> P1 -> P2 escalation protects wait time.
 */
export async function processInboundAutomations(params: {
  conversationId: string;
  customerPhone: string;
  inboundText: string;
  isNewConversation: boolean;
}): Promise<void> {
  await ensureDatabasesBootstrapped();
  const conv = getRawLibSqlClient("conversations");

  const convRes = await conv.execute({
    sql: `SELECT * FROM conversations WHERE id = ? LIMIT 1`,
    args: [params.conversationId],
  });
  const convRow = (convRes.rows[0] || {}) as Record<string, unknown>;
  const currentAssignedId = convRow.assigned_staff_id
    ? String(convRow.assigned_staff_id)
    : "";
  // STRICT RULE: ACRIO is ONLY used when the chat is assigned to System ('ACRIO')!
  // Never run ACRIO on chats assigned to human staff/teams so AI credits and ₹0.30 bills are saved.
  const isHandledByAcrio = currentAssignedId === "ACRIO";

  const rulesRes = await conv.execute(
    `SELECT * FROM automations WHERE is_enabled = 1`
  );
  const lower = params.inboundText.toLowerCase().trim();
  const nowIso = new Date().toISOString();

  // Automatic WhatsApp Opt-Out Protection: if customer replies STOP / UNSUBSCRIBE, mark opted out immediately!
  if (/^(stop|stop\s*promotions|stop\s*offers|unsubscribe|opt\s*out)\W*$/i.test(lower)) {
    const crm = getRawLibSqlClient("crm_orders");
    const mkt = getRawLibSqlClient("marketing");
    await crm.execute({
      sql: `UPDATE customers SET opt_in_marketing = 0, last_interaction_at = ? WHERE phone = ?`,
      args: [nowIso, params.customerPhone],
    });
    await mkt.execute({
      sql: `UPDATE broadcast_recipients
            SET status = 'SKIPPED',
                skip_or_error_reason = 'Customer replied STOP to opt out'
            WHERE customer_phone = ? AND status = 'QUEUED'`,
      args: [params.customerPhone],
    });
    const confirmBody =
      "You have been removed from our promotional messages. You can still message us here anytime for orders or support.";
    const sendRes = await sendWhatsAppCloudMessage({
      toPhone: params.customerPhone,
      bodyText: confirmBody,
      simulateAsyncDelivery: true,
    });
    const optOutMsgId = `msg_optout_${crypto.randomUUID().slice(0, 8)}`;
    await conv.execute({
      sql: `INSERT INTO messages (
        id, conversation_id, direction, sender_type, sender_name, message_type,
        billing_category, body, wa_message_id, delivery_status, created_at
      ) VALUES (?, ?, 'OUTBOUND', 'AUTOMATION', 'Opt-Out Protection', 'TEXT', 'FREE_CHAT', ?, ?, ?, ?)`,
      args: [
        optOutMsgId,
        params.conversationId,
        confirmBody,
        sendRes.waMessageId,
        sendRes.deliveryStatus,
        nowIso,
      ],
    });
    if (sendRes.ok && sendRes.mode === "SANDBOX_SIMULATOR") {
      scheduleSandboxDeliveryReceipt({
        conversationId: params.conversationId,
        messageId: optOutMsgId,
        waMessageId: sendRes.waMessageId,
      });
    }
    socketHub.emit("message:new", {
      conversationId: params.conversationId,
      senderName: "Opt-Out Protection",
      text: confirmBody,
    });
    return;
  }

  for (const r of rulesRes.rows) {
    const triggerType = String(r.trigger_type);
    const cond = String(r.trigger_condition || "").toLowerCase();
    const actionType = String(r.action_type);
    let payload: Record<string, unknown> = {};
    try {
      payload = JSON.parse(String(r.action_payload_json || "{}"));
    } catch {
      payload = {};
    }

    let matched = false;
    if (triggerType === "FIRST_CONTACT" && params.isNewConversation) {
      matched = true;
    } else if (triggerType === "KEYWORD" && cond) {
      const words = cond.split(",").map((w) => w.trim()).filter(Boolean);
      matched = words.some((w) => lower.includes(w));
    }

    if (!matched) continue;

    await conv.execute({
      sql: `UPDATE automations SET runs_count = runs_count + 1, last_triggered_at = ? WHERE id = ?`,
      args: [nowIso, String(r.id)],
    });

    if (actionType === "SMART_TAG") {
      await conv.execute({
        sql: `UPDATE conversations
              SET smart_category = COALESCE(?, smart_category),
                  priority = COALESCE(?, priority)
              WHERE id = ?`,
        args: [
          payload.smartCategory ? String(payload.smartCategory) : null,
          payload.priority ? String(payload.priority) : null,
          params.conversationId,
        ],
      });
    } else if (actionType === "AUTO_REPLY" && payload.replyText && !isHandledByAcrio) {
      // Only fire static keyword auto-replies when ACRIO isn't already answering automatically
      const replyBody = String(payload.replyText);
      const sendRes = await sendWhatsAppCloudMessage({
        toPhone: params.customerPhone,
        bodyText: replyBody,
        simulateAsyncDelivery: true,
      });
      const msgId = `msg_${crypto.randomUUID().slice(0, 8)}`;
      await conv.execute({
        sql: `INSERT INTO messages (
          id, conversation_id, direction, sender_type, sender_name, message_type,
          billing_category, body, wa_message_id, delivery_status, created_at
        ) VALUES (?, ?, 'OUTBOUND', 'AUTOMATION', ?, 'TEXT', 'FREE_CHAT', ?, ?, ?, ?)`,
        args: [
          msgId,
          params.conversationId,
          String(r.name),
          replyBody,
          sendRes.waMessageId,
          sendRes.deliveryStatus,
          nowIso,
        ],
      });
      if (sendRes.ok && sendRes.mode === "SANDBOX_SIMULATOR") {
        scheduleSandboxDeliveryReceipt({
          conversationId: params.conversationId,
          messageId: msgId,
          waMessageId: sendRes.waMessageId,
        });
      }
    }
  }

  // Case A: Chat is already connected to a human staff member -> keep human owner & start wait timer
  if (!isHandledByAcrio) {
    await conv.execute({
      sql: `UPDATE conversations
            SET waiting_since = COALESCE(waiting_since, ?)
            WHERE id = ?`,
      args: [nowIso, params.conversationId],
    });
    return;
  }

  // Case B: Initial / active ACRIO assignment -> ACRIO handles the query automatically in the backend!
  const recentRes = await conv.execute({
    sql: `SELECT direction, body FROM messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT 6`,
    args: [params.conversationId],
  });
  const recentMessages = [...recentRes.rows].reverse().map((m) => ({
    direction: String(m.direction),
    body: String(m.body),
  }));

  const acrioTurn = await runAcrioAutonomousTurn({
    customerName: String(convRow.customer_name || params.customerPhone),
    inboundText: params.inboundText,
    recentMessages,
  });

  // Send ACRIO's automatic WhatsApp reply (either answering directly or confirming handoff to Sales Team)
  const sendRes = await sendWhatsAppCloudMessage({
    toPhone: params.customerPhone,
    bodyText: acrioTurn.customerReply,
    simulateAsyncDelivery: true,
  });
  const acrioMsgId = `msg_acrio_${crypto.randomUUID().slice(0, 8)}`;
  const replyIso = new Date().toISOString();

  await conv.execute({
    sql: `INSERT INTO messages (
      id, conversation_id, direction, sender_type, sender_name, message_type,
      billing_category, body, wa_message_id, delivery_status, created_at
    ) VALUES (?, ?, 'OUTBOUND', 'ACRIO', 'ACRIO', 'TEXT', 'ACRIO', ?, ?, ?, ?)`,
    args: [
      acrioMsgId,
      params.conversationId,
      acrioTurn.customerReply,
      sendRes.waMessageId,
      sendRes.deliveryStatus,
      replyIso,
    ],
  });

  if (sendRes.ok && sendRes.mode === "SANDBOX_SIMULATOR") {
    scheduleSandboxDeliveryReceipt({
      conversationId: params.conversationId,
      messageId: acrioMsgId,
      waMessageId: sendRes.waMessageId,
    });
  }

  await recordDualPricingLedgerEntry({
    messageId: acrioMsgId,
    conversationId: params.conversationId,
    customerPhone: params.customerPhone,
    category: "ACRIO",
    staffName: "ACRIO Auto-Handler",
  });

  if (!acrioTurn.needsHumanHandoff) {
    // ACRIO answered the query automatically — keep assigned to ACRIO with zero customer wait!
    await conv.execute({
      sql: `UPDATE conversations
            SET status = 'OPEN',
                assigned_staff_id = 'ACRIO',
                assigned_staff_name = 'ACRIO',
                assigned_team_id = NULL,
                assigned_team_name = 'System (ACRIO)',
                smart_category = ?,
                priority = ?,
                escalation_level = 'P0',
                waiting_since = NULL,
                unread_count = 0,
                last_message_preview = ?,
                last_message_at = ?
            WHERE id = ?`,
      args: [
        acrioTurn.smartCategory,
        acrioTurn.priority,
        `ACRIO: ${acrioTurn.customerReply}`.slice(0, 140),
        replyIso,
        params.conversationId,
      ],
    });
    socketHub.emit("message:new", {
      conversationId: params.conversationId,
      senderName: "ACRIO",
      text: acrioTurn.customerReply,
    });
    return;
  }

  // Customer asked to speak to support OR ACRIO could not resolve -> connect to Sales Team (default always)!
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
      params.inboundText.slice(0, 140),
      replyIso,
      params.conversationId,
    ],
  });

  const assigned = await smartAssignConversation({
    conversationId: params.conversationId,
    inboundText: params.inboundText,
    preferredTeamId: "team_sales",
    onlyIfUnassigned: false,
    startWaitingTimer: true,
    handoffReasonFromAcrio: acrioTurn.handoffReason,
  });

  socketHub.emit("conversation:assigned", {
    conversationId: params.conversationId,
    assignedTeamName: assigned.assignedTeamName,
    assignedStaffName: assigned.assignedStaffName,
    escalationLevel: assigned.escalationLevel,
  });
}

/**
 * Smart Team & Least-Loaded Agent Assignment Engine:
 * - Defaults ALWAYS to `Sales Team` (`team_sales`) when connecting from ACRIO or when no team is specified.
 * - Picks the available P0 responder with the fewest active open chats (falling back to P1, then P2).
 * - Starts `waiting_since` so customer wait time and P0 -> P1 -> P2 escalation are tracked automatically.
 */
export async function smartAssignConversation(params: {
  conversationId: string;
  inboundText?: string;
  preferredTeamId?: string;
  preferredTier?: "P0" | "P1" | "P2";
  allowKeywordRouting?: boolean;
  onlyIfUnassigned?: boolean;
  startWaitingTimer?: boolean;
  triggeredByName?: string;
  handoffReasonFromAcrio?: string;
}): Promise<{
  assignedTeamId: string | null;
  assignedTeamName: string | null;
  assignedStaffId: string | null;
  assignedStaffName: string | null;
  escalationLevel: "P0" | "P1" | "P2";
}> {
  await ensureDatabasesBootstrapped();
  const conv = getRawLibSqlClient("conversations");
  const nowIso = new Date().toISOString();

  const existingRes = await conv.execute({
    sql: `SELECT * FROM conversations WHERE id = ? LIMIT 1`,
    args: [params.conversationId],
  });
  const current = existingRes.rows[0] as Record<string, unknown> | undefined;
  if (!current) {
    return {
      assignedTeamId: null,
      assignedTeamName: null,
      assignedStaffId: null,
      assignedStaffName: null,
      escalationLevel: "P0",
    };
  }

  const existingStaffId = current.assigned_staff_id
    ? String(current.assigned_staff_id)
    : "";
  if (params.onlyIfUnassigned && existingStaffId && existingStaffId !== "ACRIO") {
    if (params.startWaitingTimer && !current.waiting_since) {
      await conv.execute({
        sql: `UPDATE conversations SET waiting_since = ? WHERE id = ?`,
        args: [nowIso, params.conversationId],
      });
    }
    return {
      assignedTeamId: current.assigned_team_id ? String(current.assigned_team_id) : null,
      assignedTeamName: current.assigned_team_name ? String(current.assigned_team_name) : null,
      assignedStaffId: existingStaffId,
      assignedStaffName: current.assigned_staff_name ? String(current.assigned_staff_name) : null,
      escalationLevel: (String(current.escalation_level || "P0") as "P0" | "P1" | "P2"),
    };
  }

  const teamsRes = await conv.execute(
    `SELECT * FROM teams ORDER BY priority_rank ASC, created_at ASC`
  );
  const allTeams = teamsRes.rows as Record<string, unknown>[];
  if (allTeams.length === 0) {
    return {
      assignedTeamId: null,
      assignedTeamName: null,
      assignedStaffId: null,
      assignedStaffName: null,
      escalationLevel: "P0",
    };
  }

  const salesTeam =
    allTeams.find((t) => String(t.id) === "team_sales") ||
    allTeams.find((t) => /sales/i.test(String(t.name))) ||
    allTeams[0];

  let chosenTeam = params.preferredTeamId
    ? allTeams.find((t) => String(t.id) === params.preferredTeamId)
    : undefined;

  if (!chosenTeam && params.allowKeywordRouting) {
    const textLower = String(
      params.inboundText || current.last_message_preview || ""
    ).toLowerCase();
    for (const t of allTeams) {
      if (Number(t.auto_assign_enabled ?? 1) !== 1) continue;
      const kwList = String(t.routing_keywords || "")
        .split(",")
        .map((k) => k.trim().toLowerCase())
        .filter(Boolean);
      if (kwList.some((kw) => textLower.includes(kw))) {
        chosenTeam = t;
        break;
      }
    }
  }

  // Default ALWAYS to Sales Team when connecting to staff
  if (!chosenTeam) {
    chosenTeam = salesTeam;
  }

  const teamId = String(chosenTeam.id);
  const teamName = String(chosenTeam.name);

  // Load active chat counts per staff member for smart least-loaded balancing
  const [membersRes, loadRes] = await Promise.all([
    conv.execute({
      sql: `SELECT * FROM team_members WHERE team_id = ? AND is_available = 1`,
      args: [teamId],
    }),
    conv.execute(
      `SELECT assigned_staff_id, COUNT(*) as open_cnt
       FROM conversations
       WHERE status != 'RESOLVED' AND assigned_staff_id IS NOT NULL AND assigned_staff_id != 'ACRIO'
       GROUP BY assigned_staff_id`
    ),
  ]);

  const loadMap = new Map<string, number>();
  for (const r of loadRes.rows) {
    loadMap.set(String(r.assigned_staff_id), Number(r.open_cnt ?? 0));
  }

  const tierOrder: ("P0" | "P1" | "P2")[] =
    params.preferredTier === "P1"
      ? ["P1", "P2", "P0"]
      : params.preferredTier === "P2"
      ? ["P2", "P1", "P0"]
      : ["P0", "P1", "P2"];

  let chosenMember: Record<string, unknown> | null = null;
  let chosenTier: "P0" | "P1" | "P2" = params.preferredTier || "P0";

  for (const tier of tierOrder) {
    const candidates = (membersRes.rows as Record<string, unknown>[]).filter(
      (m) => String(m.tier) === tier
    );
    if (candidates.length === 0) continue;

    candidates.sort((a, b) => {
      const loadA = loadMap.get(String(a.staff_id)) ?? 0;
      const loadB = loadMap.get(String(b.staff_id)) ?? 0;
      return loadA - loadB;
    });

    const underCap = candidates.find(
      (c) => (loadMap.get(String(c.staff_id)) ?? 0) < Number(c.max_active_chats ?? 15)
    );
    chosenMember = underCap || candidates[0];
    chosenTier = tier;
    break;
  }

  const staffId = chosenMember ? String(chosenMember.staff_id) : null;
  const staffName = chosenMember ? String(chosenMember.staff_name) : null;

  await conv.execute({
    sql: `UPDATE conversations
          SET status = 'ASSIGNED',
              assigned_team_id = ?,
              assigned_team_name = ?,
              assigned_staff_id = ?,
              assigned_staff_name = ?,
              escalation_level = ?,
              waiting_since = CASE
                WHEN ? = 1 THEN COALESCE(waiting_since, ?)
                ELSE waiting_since
              END
          WHERE id = ?`,
    args: [
      teamId,
      teamName,
      staffId,
      staffName,
      chosenTier,
      params.startWaitingTimer ? 1 : 0,
      nowIso,
      params.conversationId,
    ],
  });

  if (params.handoffReasonFromAcrio) {
    await conv.execute({
      sql: `INSERT INTO messages (
        id, conversation_id, direction, sender_type, sender_name, message_type,
        billing_category, body, delivery_status, created_at
      ) VALUES (?, ?, 'INTERNAL', 'STAFF_NOTE', 'ACRIO Handover', 'INTERNAL_NOTE', 'INTERNAL', ?, 'SAVED', ?)`,
      args: [
        `msg_note_${crypto.randomUUID().slice(0, 8)}`,
        params.conversationId,
        `${params.handoffReasonFromAcrio} Assigned to ${teamName} (${chosenTier}: ${staffName || "Team"}).`,
        nowIso,
      ],
    });
  } else if (params.triggeredByName && staffName) {
    await conv.execute({
      sql: `INSERT INTO messages (
        id, conversation_id, direction, sender_type, sender_name, message_type,
        billing_category, body, delivery_status, created_at
      ) VALUES (?, ?, 'INTERNAL', 'STAFF_NOTE', ?, 'INTERNAL_NOTE', 'INTERNAL', ?, 'SAVED', ?)`,
      args: [
        `msg_note_${crypto.randomUUID().slice(0, 8)}`,
        params.conversationId,
        params.triggeredByName,
        `Assigned to ${teamName} (${chosenTier}: ${staffName}).`,
        nowIso,
      ],
    });
  }

  socketHub.emit("conversation:assigned", {
    conversationId: params.conversationId,
    assignedTeamName: teamName,
    assignedStaffName: staffName,
    escalationLevel: chosenTier,
  });

  return {
    assignedTeamId: teamId,
    assignedTeamName: teamName,
    assignedStaffId: staffId,
    assignedStaffName: staffName,
    escalationLevel: chosenTier,
  };
}

/**
 * Automatic P0 -> P1 -> P2 Wait-Time Escalation Engine:
 * Checks open/assigned chats where `waiting_since` is active.
 * If customer waits past team's P0 threshold -> escalates to P1 responder + logs Internal Team Note.
 * If customer waits past team's P1 threshold -> escalates to P2 lead + logs Internal Team Note.
 */
export async function checkAndEscalateWaitingChats(): Promise<number> {
  await ensureDatabasesBootstrapped();
  const conv = getRawLibSqlClient("conversations");
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();

  const [waitingRes, teamsRes, membersRes, loadRes] = await Promise.all([
    conv.execute(
      `SELECT * FROM conversations
       WHERE status != 'RESOLVED'
         AND waiting_since IS NOT NULL
         AND COALESCE(assigned_staff_id, '') != 'ACRIO'`
    ),
    conv.execute(`SELECT * FROM teams`),
    conv.execute(`SELECT * FROM team_members WHERE is_available = 1`),
    conv.execute(
      `SELECT assigned_staff_id, COUNT(*) as open_cnt
       FROM conversations
       WHERE status != 'RESOLVED' AND assigned_staff_id IS NOT NULL AND assigned_staff_id != 'ACRIO'
       GROUP BY assigned_staff_id`
    ),
  ]);

  if (waitingRes.rows.length === 0) return 0;

  const teamMap = new Map<string, Record<string, unknown>>();
  for (const t of teamsRes.rows) {
    teamMap.set(String(t.id), t as Record<string, unknown>);
  }
  const defaultTeam =
    teamMap.get("team_sales") ||
    (teamsRes.rows[0] as Record<string, unknown> | undefined);

  const loadMap = new Map<string, number>();
  for (const r of loadRes.rows) {
    loadMap.set(String(r.assigned_staff_id), Number(r.open_cnt ?? 0));
  }

  let escalatedCount = 0;

  for (const row of waitingRes.rows) {
    const convId = String(row.id);
    const waitingSinceMs = new Date(String(row.waiting_since)).getTime();
    if (Number.isNaN(waitingSinceMs)) continue;

    const waitedMinutes = (nowMs - waitingSinceMs) / 60000;
    const currentLevel = String(row.escalation_level || "P0") as "P0" | "P1" | "P2";
    const teamId = row.assigned_team_id
      ? String(row.assigned_team_id)
      : defaultTeam
      ? String(defaultTeam.id)
      : "";
    const team = teamMap.get(teamId) || defaultTeam;
    const teamName = team ? String(team.name) : "Sales Team";

    const p0Wait = Number(team?.p0_wait_minutes ?? 5);
    const p1Wait = Number(team?.p1_wait_minutes ?? 12);

    let targetTier: "P1" | "P2" | null = null;
    if (currentLevel === "P0" && waitedMinutes >= p0Wait) {
      targetTier = "P1";
    } else if (currentLevel === "P1" && waitedMinutes >= p1Wait) {
      targetTier = "P2";
    }

    if (!targetTier) continue;

    const teamMembers = (membersRes.rows as Record<string, unknown>[]).filter(
      (m) => String(m.team_id) === teamId && String(m.tier) === targetTier
    );
    const fallbackMembers =
      teamMembers.length > 0
        ? teamMembers
        : (membersRes.rows as Record<string, unknown>[]).filter(
            (m) => String(m.tier) === targetTier
          );

    fallbackMembers.sort((a, b) => {
      const loadA = loadMap.get(String(a.staff_id)) ?? 0;
      const loadB = loadMap.get(String(b.staff_id)) ?? 0;
      return loadA - loadB;
    });

    const nextResponder = fallbackMembers[0];
    const nextStaffId = nextResponder
      ? String(nextResponder.staff_id)
      : row.assigned_staff_id
      ? String(row.assigned_staff_id)
      : null;
    const nextStaffName = nextResponder
      ? String(nextResponder.staff_name)
      : row.assigned_staff_name
      ? String(row.assigned_staff_name)
      : "Team Lead";

    const nextPriority = targetTier === "P2" ? "URGENT" : "HIGH";
    const roundedMins = Math.max(1, Math.floor(waitedMinutes));

    await conv.batch(
      [
        {
          sql: `UPDATE conversations
                SET status = 'ASSIGNED',
                    assigned_team_id = COALESCE(assigned_team_id, ?),
                    assigned_team_name = COALESCE(assigned_team_name, ?),
                    assigned_staff_id = ?,
                    assigned_staff_name = ?,
                    escalation_level = ?,
                    priority = ?,
                    escalated_at = ?
                WHERE id = ?`,
          args: [
            teamId || null,
            teamName,
            nextStaffId,
            nextStaffName,
            targetTier,
            nextPriority,
            nowIso,
            convId,
          ],
        },
        {
          sql: `INSERT INTO messages (
            id, conversation_id, direction, sender_type, sender_name, message_type,
            billing_category, body, delivery_status, created_at
          ) VALUES (?, ?, 'INTERNAL', 'STAFF_NOTE', 'Auto-Escalation', 'INTERNAL_NOTE', 'INTERNAL', ?, 'SAVED', ?)`,
          args: [
            `msg_esc_${crypto.randomUUID().slice(0, 8)}`,
            convId,
            `Customer waited ${roundedMins} min without a reply. Escalated from ${currentLevel} to ${targetTier} (${nextStaffName}, ${teamName}).`,
            nowIso,
          ],
        },
      ],
      "write"
    );

    escalatedCount++;
    socketHub.emit("chat:escalated", {
      conversationId: convId,
      fromTier: currentLevel,
      toTier: targetTier,
      assignedStaffName: nextStaffName,
      teamName,
      waitedMinutes: roundedMins,
    });
  }

  return escalatedCount;
}

/**
 * Processes pending jobs across queues (`backup:midnight_gdrive`, `whatsapp:broadcast`, etc.)
 */
export async function drainPendingWorkerJobs(): Promise<number> {
  const jobs = await claimPendingJobs(undefined, 8);
  let processed = 0;

  for (const job of jobs) {
    try {
      if (job.queueName === "backup:midnight_gdrive") {
        const source =
          job.payload.triggerSource === "MANUAL_DEV"
            ? "MANUAL_DEV"
            : "MIDNIGHT_CRON";
        const res = await executeMultiDatabaseBackup(source);
        if (!res.ok) throw new Error(res.detailsMessage);
      } else if (job.queueName === "whatsapp:broadcast") {
        await executeBroadcastJob(job.payload);
      }
      await completeJob(job.id);
      processed++;
    } catch (err: any) {
      await failJob(job, err?.message || "Worker job error");
    }
  }

  await recordWorkerHeartbeat("cc-primary-worker", "ONLINE", processed, {
    lastCheckedAt: new Date().toISOString(),
  });

  if (processed > 0) {
    socketHub.emit("queue:updated", { processed });
  }
  return processed;
}

export type BroadcastPacingMode =
  | "SAFE_STEADY"
  | "EXTRA_CAREFUL"
  | "WARMED_FAST";

export interface BroadcastQueueSafetySettings {
  defaultPacingMode: BroadcastPacingMode;
  delaySeconds: number;
  batchSize: number;
  batchPauseSeconds: number;
  skipRecentHours: number;
  dailyMarketingCap: number;
  autoPauseOnConsecutiveFailures: number;
  quietHoursEnabled: boolean;
  sentTodayMarketingCount: number;
}

export async function getBroadcastQueueSettings(): Promise<BroadcastQueueSafetySettings> {
  await ensureDatabasesBootstrapped();
  const mkt = getRawLibSqlClient("marketing");
  const { dateKey } = getCurrentIstDateAndTime();
  const startOfDayIso = new Date(`${dateKey}T00:00:00+05:30`).toISOString();

  const [cfgRes, todayRes] = await Promise.all([
    mkt.execute(
      `SELECT * FROM broadcast_queue_settings WHERE id = 'default' LIMIT 1`
    ),
    mkt.execute({
      sql: `SELECT COUNT(*) as cnt FROM broadcast_recipients r
            JOIN broadcasts b ON b.id = r.broadcast_id
            WHERE b.billing_category = 'MARKETING'
              AND r.status IN ('SENT', 'DELIVERED', 'READ')
              AND r.sent_at >= ?`,
      args: [startOfDayIso],
    }),
  ]);

  const row = (cfgRes.rows[0] || {}) as Record<string, unknown>;
  const modeRaw = String(row.default_pacing_mode || "SAFE_STEADY");
  const defaultPacingMode: BroadcastPacingMode =
    modeRaw === "EXTRA_CAREFUL" || modeRaw === "WARMED_FAST"
      ? modeRaw
      : "SAFE_STEADY";

  return {
    defaultPacingMode,
    delaySeconds: Math.max(1, Number(row.delay_seconds ?? 4)),
    batchSize: Math.max(5, Number(row.batch_size ?? 25)),
    batchPauseSeconds: Math.max(0, Number(row.batch_pause_seconds ?? 20)),
    skipRecentHours: Math.max(0, Number(row.skip_recent_hours ?? 24)),
    dailyMarketingCap: Math.max(10, Number(row.daily_marketing_cap ?? 250)),
    autoPauseOnConsecutiveFailures: Math.max(
      1,
      Number(row.auto_pause_on_consecutive_failures ?? 3)
    ),
    quietHoursEnabled: Number(row.quiet_hours_enabled ?? 0) === 1,
    sentTodayMarketingCount: Number(todayRes.rows[0]?.cnt ?? 0),
  };
}

export async function updateBroadcastQueueSettings(params: {
  defaultPacingMode?: BroadcastPacingMode;
  delaySeconds?: number;
  batchSize?: number;
  batchPauseSeconds?: number;
  skipRecentHours?: number;
  dailyMarketingCap?: number;
  autoPauseOnConsecutiveFailures?: number;
  quietHoursEnabled?: boolean;
  updatedBy: string;
}): Promise<BroadcastQueueSafetySettings> {
  const current = await getBroadcastQueueSettings();
  const mkt = getRawLibSqlClient("marketing");
  const nowIso = new Date().toISOString();

  const nextMode = params.defaultPacingMode || current.defaultPacingMode;
  const nextDelay =
    params.delaySeconds !== undefined
      ? Math.max(1, Math.min(120, Math.round(params.delaySeconds)))
      : current.delaySeconds;
  const nextBatch =
    params.batchSize !== undefined
      ? Math.max(5, Math.min(200, Math.round(params.batchSize)))
      : current.batchSize;
  const nextPause =
    params.batchPauseSeconds !== undefined
      ? Math.max(0, Math.min(600, Math.round(params.batchPauseSeconds)))
      : current.batchPauseSeconds;
  const nextSkipHrs =
    params.skipRecentHours !== undefined
      ? Math.max(0, Math.min(720, Math.round(params.skipRecentHours)))
      : current.skipRecentHours;
  const nextDailyCap =
    params.dailyMarketingCap !== undefined
      ? Math.max(10, Math.min(500000, Math.round(params.dailyMarketingCap)))
      : current.dailyMarketingCap;
  const nextAutoPause =
    params.autoPauseOnConsecutiveFailures !== undefined
      ? Math.max(
          1,
          Math.min(20, Math.round(params.autoPauseOnConsecutiveFailures))
        )
      : current.autoPauseOnConsecutiveFailures;
  const nextQuiet =
    params.quietHoursEnabled !== undefined
      ? params.quietHoursEnabled
      : current.quietHoursEnabled;

  await mkt.execute({
    sql: `UPDATE broadcast_queue_settings
          SET default_pacing_mode = ?,
              delay_seconds = ?,
              batch_size = ?,
              batch_pause_seconds = ?,
              skip_recent_hours = ?,
              daily_marketing_cap = ?,
              auto_pause_on_consecutive_failures = ?,
              quiet_hours_enabled = ?,
              updated_by = ?,
              updated_at = ?
          WHERE id = 'default'`,
    args: [
      nextMode,
      nextDelay,
      nextBatch,
      nextPause,
      nextSkipHrs,
      nextDailyCap,
      nextAutoPause,
      nextQuiet ? 1 : 0,
      params.updatedBy,
      nowIso,
    ],
  });

  return getBroadcastQueueSettings();
}

function pacingDefaultsForMode(
  mode: BroadcastPacingMode,
  fallback: BroadcastQueueSafetySettings
): { delaySeconds: number; batchSize: number; batchPauseSeconds: number } {
  if (mode === "EXTRA_CAREFUL") {
    return { delaySeconds: 8, batchSize: 15, batchPauseSeconds: 30 };
  }
  if (mode === "WARMED_FAST") {
    return { delaySeconds: 2, batchSize: 40, batchPauseSeconds: 15 };
  }
  return {
    delaySeconds: fallback.delaySeconds || 4,
    batchSize: fallback.batchSize || 25,
    batchPauseSeconds: fallback.batchPauseSeconds ?? 20,
  };
}

/**
 * Enqueues a marketing or utility broadcast into the anti-spam recipient queue:
 * - Deduplicates phones
 * - Skips opted-out contacts (`opt_in_marketing = 0`)
 * - Skips contacts already messaged within `skipRecentHours` (for MARKETING)
 * - Enforces `dailyMarketingCap` so Meta's messaging tier limit is never breached
 * - Staggers `scheduled_at` slots across `delaySeconds` + `batchPauseSeconds`
 */
export async function enqueueBroadcastIntoSafeQueue(params: {
  name?: string;
  listId: string;
  templateId: string;
  pacingMode?: BroadcastPacingMode;
  skipRecentHoursOverride?: number;
  scheduledForIso?: string | null;
  customVariablesOverride?: Record<string, string>;
  createdByName: string;
}): Promise<{
  ok: boolean;
  broadcastId?: string;
  queuedCount?: number;
  skippedCount?: number;
  estimatedDurationSeconds?: number;
  error?: string;
}> {
  await ensureDatabasesBootstrapped();
  const mkt = getRawLibSqlClient("marketing");
  const crm = getRawLibSqlClient("crm_orders");

  const [lRes, tRes, settings] = await Promise.all([
    mkt.execute({
      sql: `SELECT * FROM marketing_lists WHERE id = ? LIMIT 1`,
      args: [params.listId],
    }),
    mkt.execute({
      sql: `SELECT * FROM templates WHERE id = ? LIMIT 1`,
      args: [params.templateId],
    }),
    getBroadcastQueueSettings(),
  ]);

  if (!lRes.rows[0] || !tRes.rows[0]) {
    return { ok: false, error: "Please select a valid customer list and template." };
  }

  const listRow = lRes.rows[0] as Record<string, unknown>;
  const tplRow = tRes.rows[0] as Record<string, unknown>;

  if (String(tplRow.approval_status) !== "APPROVED") {
    return {
      ok: false,
      error: `Template "${String(tplRow.name)}" is currently ${String(
        tplRow.approval_status
      )}. Only Approved templates can be sent in broadcasts.`,
    };
  }

  let rawPhones: string[] = [];
  try {
    rawPhones = JSON.parse(String(listRow.member_phones_json || "[]"));
  } catch {
    rawPhones = [];
  }

  // Deduplicate phones while preserving order
  const seenDigits = new Set<string>();
  const uniquePhones: string[] = [];
  for (const p of rawPhones) {
    const d = String(p || "").replace(/\D/g, "");
    if (d.length >= 10 && !seenDigits.has(d)) {
      seenDigits.add(d);
      uniquePhones.push(p.startsWith("+") ? p : `+${d}`);
    }
  }

  if (uniquePhones.length === 0) {
    return { ok: false, error: "This customer list has no valid WhatsApp phone numbers." };
  }

  const mode: BroadcastPacingMode =
    params.pacingMode || settings.defaultPacingMode;
  const pacing = pacingDefaultsForMode(mode, settings);
  const skipRecentHours =
    params.skipRecentHoursOverride !== undefined
      ? Math.max(0, Number(params.skipRecentHoursOverride))
      : settings.skipRecentHours;

  const category = String(tplRow.category || "MARKETING") as BillingMessageCategory;
  const tplBody = String(tplRow.body_text || "");
  let varSpecs: Array<{
    index: number;
    sourceField?: string;
    sampleValue?: string;
  }> = [];
  try {
    varSpecs = JSON.parse(String(tplRow.variables_schema_json || "[]"));
  } catch {
    varSpecs = [];
  }

  // Fetch customer profiles & latest order numbers in bulk
  const [custRes, ordersRes] = await Promise.all([
    crm.execute(`SELECT * FROM customers`),
    crm.execute(`SELECT customer_phone, order_number FROM customer_orders ORDER BY ordered_at DESC`),
  ]);

  const customerByPhone = new Map<string, Record<string, unknown>>();
  for (const c of custRes.rows) {
    const d = String(c.phone || "").replace(/\D/g, "");
    if (d) customerByPhone.set(d, c as Record<string, unknown>);
  }
  const latestOrderByPhone = new Map<string, string>();
  for (const o of ordersRes.rows) {
    const d = String(o.customer_phone || "").replace(/\D/g, "");
    if (d && !latestOrderByPhone.has(d)) {
      latestOrderByPhone.set(d, String(o.order_number));
    }
  }

  // Recent broadcast cooldown lookup
  const recentlyMessagedDigits = new Set<string>();
  if (category === "MARKETING" && skipRecentHours > 0) {
    const cutoffIso = new Date(
      Date.now() - skipRecentHours * 3600 * 1000
    ).toISOString();
    const recentRes = await mkt.execute({
      sql: `SELECT DISTINCT customer_phone FROM broadcast_recipients
            WHERE status IN ('SENT', 'DELIVERED', 'READ') AND sent_at >= ?`,
      args: [cutoffIso],
    });
    for (const r of recentRes.rows) {
      const d = String(r.customer_phone || "").replace(/\D/g, "");
      if (d) recentlyMessagedDigits.add(d);
    }
  }

  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const startBaseMs =
    params.scheduledForIso &&
    !Number.isNaN(new Date(params.scheduledForIso).getTime()) &&
    new Date(params.scheduledForIso).getTime() > nowMs
      ? new Date(params.scheduledForIso).getTime()
      : nowMs;
  const isScheduledFuture = startBaseMs > nowMs + 5000;

  const bcId = `bc_${crypto.randomUUID().slice(0, 8)}`;
  const remainingDailyAllowance =
    category === "MARKETING"
      ? Math.max(0, settings.dailyMarketingCap - settings.sentTodayMarketingCount)
      : Number.MAX_SAFE_INTEGER;

  let queuedCount = 0;
  let skippedCount = 0;
  let cumulativeDelaySec = 0;
  const recipientInserts: Array<{ sql: string; args: any[] }> = [];

  const bodyVarIndices = Array.from(
    new Set(Array.from(tplBody.matchAll(/\{\{(\d+)\}\}/g)).map((m) => Number(m[1])))
  ).sort((a, b) => a - b);

  for (const phone of uniquePhones) {
    const digits = phone.replace(/\D/g, "");
    const cust = customerByPhone.get(digits);
    const custName = cust ? String(cust.name || phone) : phone;
    const firstName = custName.split(/[\s(]/)[0] || "Sir/Madam";
    const optIn = cust ? Number(cust.opt_in_marketing ?? 1) === 1 : true;

    let skipReason: string | null = null;
    if (!optIn && category === "MARKETING") {
      skipReason = "Customer opted out of promotions";
    } else if (category === "MARKETING" && recentlyMessagedDigits.has(digits)) {
      skipReason = `Already received a broadcast in the last ${skipRecentHours}h`;
    } else if (category === "MARKETING" && queuedCount >= remainingDailyAllowance) {
      skipReason = `Daily WhatsApp marketing cap (${settings.dailyMarketingCap}/day) reached`;
    }

    // Resolve personalized variables
    const resolvedVars = bodyVarIndices.map((idx) => {
      const overrideVal = params.customVariablesOverride?.[String(idx)];
      if (overrideVal && overrideVal.trim()) return overrideVal.trim();

      const spec = varSpecs.find((v) => v.index === idx);
      const src = spec?.sourceField || (idx === 1 ? "customer.firstName" : "custom");
      if (src === "customer.firstName") return firstName;
      if (src === "customer.fullName") return custName;
      if (src === "customer.companyName")
        return String(cust?.company_name || firstName);
      if (src === "customer.city") return String(cust?.city || "India");
      if (src === "order.latestNumber")
        return latestOrderByPhone.get(digits) || spec?.sampleValue || "CC-2026";
      return spec?.sampleValue || firstName;
    });

    let renderedBody = tplBody;
    bodyVarIndices.forEach((idx, pos) => {
      renderedBody = renderedBody.replace(
        new RegExp(`\\{\\{${idx}\\}\\}`, "g"),
        resolvedVars[pos] || ""
      );
    });

    if (skipReason) {
      skippedCount++;
      recipientInserts.push({
        sql: `INSERT INTO broadcast_recipients (
          id, broadcast_id, customer_name, customer_phone, variables_json, rendered_body,
          status, skip_or_error_reason, attempts, scheduled_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'SKIPPED', ?, 0, ?, ?)`,
        args: [
          `bcr_${crypto.randomUUID().slice(0, 8)}`,
          bcId,
          custName,
          phone,
          JSON.stringify(resolvedVars),
          renderedBody,
          skipReason,
          nowIso,
          nowIso,
        ],
      });
      continue;
    }

    if (queuedCount > 0) {
      cumulativeDelaySec += pacing.delaySeconds;
      if (queuedCount % pacing.batchSize === 0) {
        cumulativeDelaySec += pacing.batchPauseSeconds;
      }
    }
    const scheduledIso = new Date(
      startBaseMs + cumulativeDelaySec * 1000
    ).toISOString();
    queuedCount++;

    recipientInserts.push({
      sql: `INSERT INTO broadcast_recipients (
        id, broadcast_id, customer_name, customer_phone, variables_json, rendered_body,
        status, attempts, scheduled_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'QUEUED', 0, ?, ?)`,
      args: [
        `bcr_${crypto.randomUUID().slice(0, 8)}`,
        bcId,
        custName,
        phone,
        JSON.stringify(resolvedVars),
        renderedBody,
        scheduledIso,
        nowIso,
      ],
    });
  }

  const initialStatus =
    queuedCount === 0
      ? "COMPLETED"
      : isScheduledFuture
      ? "SCHEDULED"
      : "SENDING";

  await mkt.batch(
    [
      {
        sql: `INSERT INTO broadcasts (
          id, name, list_id, list_name, template_id, template_name, billing_category,
          status, pacing_mode, delay_seconds, batch_size, batch_pause_seconds, skip_recent_hours,
          total_recipients, queued_count, skipped_count, failed_count, sent_count, delivered_count, read_count,
          client_billed_inr, actual_meta_cost_inr, scheduled_for, next_dispatch_at, started_at, completed_at,
          created_by_name, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, 0, 0, ?, ?, ?, ?, ?, ?)`,
        args: [
          bcId,
          (params.name || "").trim() || `${String(listRow.name)} Campaign`,
          params.listId,
          String(listRow.name),
          params.templateId,
          String(tplRow.name),
          category,
          initialStatus,
          mode,
          pacing.delaySeconds,
          pacing.batchSize,
          pacing.batchPauseSeconds,
          skipRecentHours,
          uniquePhones.length,
          queuedCount,
          skippedCount,
          isScheduledFuture ? new Date(startBaseMs).toISOString() : null,
          queuedCount > 0 ? new Date(startBaseMs).toISOString() : null,
          !isScheduledFuture && queuedCount > 0 ? nowIso : null,
          queuedCount === 0 ? nowIso : null,
          params.createdByName,
          nowIso,
        ],
      },
      ...recipientInserts,
    ],
    "write"
  );

  ensureBackgroundWorkersRunning();
  if (!isScheduledFuture && queuedCount > 0) {
    void processMarketingBroadcastQueue().catch(() => {});
  }

  socketHub.emit("broadcast:progress", {
    broadcastId: bcId,
    status: initialStatus,
    queuedCount,
    skippedCount,
    sent: 0,
  });

  return {
    ok: true,
    broadcastId: bcId,
    queuedCount,
    skippedCount,
    estimatedDurationSeconds: cumulativeDelaySec,
  };
}

/**
 * Legacy queue job bridge in case `whatsapp:broadcast` job exists in `queue_jobs.db`
 */
async function executeBroadcastJob(_payload: Record<string, unknown>): Promise<void> {
  await processMarketingBroadcastQueue();
}

/**
 * Safe Paced Marketing Broadcast Queue Worker:
 * Sends at most 1 message per active campaign per tick according to `delay_seconds`
 * and `batch_pause_seconds`, with automatic circuit-breaker pause if Meta flags rate/spam errors!
 */
export async function processMarketingBroadcastQueue(): Promise<number> {
  if (globalWorkerRunner.__ccMarketingQueueRunning) return 0;
  globalWorkerRunner.__ccMarketingQueueRunning = true;

  let dispatchedCount = 0;
  try {
    await ensureDatabasesBootstrapped();
    const mkt = getRawLibSqlClient("marketing");
    const settings = await getBroadcastQueueSettings();
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();

    // Activate any SCHEDULED broadcasts whose scheduled start time has arrived
    await mkt.execute({
      sql: `UPDATE broadcasts
            SET status = 'SENDING',
                started_at = COALESCE(started_at, ?)
            WHERE status = 'SCHEDULED'
              AND scheduled_for IS NOT NULL
              AND scheduled_for <= ?`,
      args: [nowIso, nowIso],
    });

    const activeRes = await mkt.execute({
      sql: `SELECT * FROM broadcasts
            WHERE status IN ('QUEUED', 'SENDING')
              AND (next_dispatch_at IS NULL OR next_dispatch_at <= ?)
            ORDER BY created_at ASC
            LIMIT 3`,
      args: [nowIso],
    });

    for (const bRow of activeRes.rows) {
      const bcId = String(bRow.id);
      const delaySec = Math.max(1, Number(bRow.delay_seconds ?? 4));
      const batchSize = Math.max(5, Number(bRow.batch_size ?? 25));
      const batchPauseSec = Math.max(0, Number(bRow.batch_pause_seconds ?? 20));
      const category = String(
        bRow.billing_category || "MARKETING"
      ) as BillingMessageCategory;

      // Pick the single next queued recipient due for sending
      const nextRecRes = await mkt.execute({
        sql: `SELECT * FROM broadcast_recipients
              WHERE broadcast_id = ? AND status = 'QUEUED'
              ORDER BY scheduled_at ASC, created_at ASC
              LIMIT 1`,
        args: [bcId],
      });

      const rec = nextRecRes.rows[0] as Record<string, unknown> | undefined;
      if (!rec) {
        // No more QUEUED recipients -> finalize campaign as COMPLETED
        await mkt.execute({
          sql: `UPDATE broadcasts
                SET status = 'COMPLETED',
                    queued_count = 0,
                    next_dispatch_at = NULL,
                    completed_at = COALESCE(completed_at, ?)
                WHERE id = ?`,
          args: [nowIso, bcId],
        });
        socketHub.emit("broadcast:progress", {
          broadcastId: bcId,
          status: "COMPLETED",
        });
        continue;
      }

      // Fetch template details for structured Meta components
      const tplRes = await mkt.execute({
        sql: `SELECT * FROM templates WHERE id = ? LIMIT 1`,
        args: [String(bRow.template_id)],
      });
      const tpl = (tplRes.rows[0] || {}) as Record<string, unknown>;
      const tplName = String(tpl.name || bRow.template_name || "");
      const tplLang = String(tpl.language || "en");
      const headerType = String(tpl.header_type || "NONE");
      const headerMediaUrl = tpl.header_media_url
        ? String(tpl.header_media_url)
        : "";

      let resolvedVars: string[] = [];
      try {
        resolvedVars = JSON.parse(String(rec.variables_json || "[]"));
      } catch {
        resolvedVars = [];
      }

      const templateComponents: Record<string, unknown>[] = [];
      if (
        (headerType === "IMAGE" ||
          headerType === "VIDEO" ||
          headerType === "DOCUMENT") &&
        headerMediaUrl
      ) {
        const mediaKey = headerType.toLowerCase();
        templateComponents.push({
          type: "header",
          parameters: [
            {
              type: mediaKey,
              [mediaKey]: { link: headerMediaUrl },
            },
          ],
        });
      }
      if (resolvedVars.length > 0) {
        templateComponents.push({
          type: "body",
          parameters: resolvedVars.map((val) => ({
            type: "text",
            text: String(val),
          })),
        });
      }

      const recId = String(rec.id);
      const phone = String(rec.customer_phone);
      const renderedBody = String(rec.rendered_body || tpl.body_text || "");

      await mkt.execute({
        sql: `UPDATE broadcast_recipients SET status = 'SENDING', attempts = attempts + 1 WHERE id = ?`,
        args: [recId],
      });

      const out = await sendWhatsAppCloudMessage({
        toPhone: phone,
        bodyText: renderedBody,
        templateName: tplName,
        languageCode: tplLang,
        templateComponents,
      });

      const finishedAtMs = Date.now();
      const finishedIso = new Date(finishedAtMs).toISOString();

      if (out.ok) {
        dispatchedCount++;
        const billed = await recordDualPricingLedgerEntry({
          broadcastId: bcId,
          customerPhone: phone,
          category,
          staffName: `Broadcast: ${String(bRow.name)}`,
        });

        const nextSentCount = Number(bRow.sent_count ?? 0) + 1;
        const isBatchBoundary = nextSentCount % batchSize === 0;
        const waitSeconds =
          delaySec + (isBatchBoundary ? batchPauseSec : 0);
        const nextDispatchIso = new Date(
          finishedAtMs + waitSeconds * 1000
        ).toISOString();

        await mkt.batch(
          [
            {
              sql: `UPDATE broadcast_recipients
                    SET status = ?,
                        sent_at = ?,
                        wa_message_id = ?,
                        skip_or_error_reason = NULL
                    WHERE id = ?`,
              args: [
                out.deliveryStatus === "DELIVERED" ? "DELIVERED" : "SENT",
                finishedIso,
                out.waMessageId,
                recId,
              ],
            },
            {
              sql: `UPDATE templates SET sent_count = sent_count + 1 WHERE id = ?`,
              args: [String(bRow.template_id)],
            },
          ],
          "write"
        );

        // Recount remaining queued items accurately
        const remRes = await mkt.execute({
          sql: `SELECT COUNT(*) as cnt FROM broadcast_recipients WHERE broadcast_id = ? AND status = 'QUEUED'`,
          args: [bcId],
        });
        const remainingQueued = Number(remRes.rows[0]?.cnt ?? 0);
        const nextStatus = remainingQueued === 0 ? "COMPLETED" : "SENDING";

        await mkt.execute({
          sql: `UPDATE broadcasts
                SET status = ?,
                    sent_count = sent_count + 1,
                    delivered_count = delivered_count + 1,
                    queued_count = ?,
                    consecutive_failures = 0,
                    client_billed_inr = ROUND(client_billed_inr + ?, 2),
                    actual_meta_cost_inr = ROUND(actual_meta_cost_inr + ?, 4),
                    next_dispatch_at = ?,
                    started_at = COALESCE(started_at, ?),
                    completed_at = CASE WHEN ? = 0 THEN ? ELSE completed_at END
                WHERE id = ?`,
          args: [
            nextStatus,
            remainingQueued,
            billed.clientUnitRateInr,
            billed.actualMetaUnitCostInr,
            remainingQueued > 0 ? nextDispatchIso : null,
            finishedIso,
            remainingQueued,
            finishedIso,
            bcId,
          ],
        });

        socketHub.emit("broadcast:progress", {
          broadcastId: bcId,
          status: nextStatus,
          sentCount: nextSentCount,
          queuedCount: remainingQueued,
          nextDispatchAt: remainingQueued > 0 ? nextDispatchIso : null,
        });
      } else {
        const nextConsecutiveFailures =
          Number(bRow.consecutive_failures ?? 0) + 1;
        const shouldCircuitBreak =
          Boolean(out.isRateOrSpamBlock) ||
          nextConsecutiveFailures >= settings.autoPauseOnConsecutiveFailures;

        await mkt.execute({
          sql: `UPDATE broadcast_recipients
                SET status = 'FAILED',
                    skip_or_error_reason = ?
                WHERE id = ?`,
          args: [out.error || "Delivery failed", recId],
        });

        const remRes = await mkt.execute({
          sql: `SELECT COUNT(*) as cnt FROM broadcast_recipients WHERE broadcast_id = ? AND status = 'QUEUED'`,
          args: [bcId],
        });
        const remainingQueued = Number(remRes.rows[0]?.cnt ?? 0);

        if (shouldCircuitBreak && remainingQueued > 0) {
          const pauseReason = out.isRateOrSpamBlock
            ? `Paused automatically to protect your WhatsApp number from Meta rate limits (${out.error || "rate limit"}). Wait 15 minutes before resuming.`
            : `Paused automatically after ${nextConsecutiveFailures} failed messages in a row (${out.error || "send error"}). Check settings and click Resume.`;

          await mkt.execute({
            sql: `UPDATE broadcasts
                  SET status = 'PAUSED',
                      failed_count = failed_count + 1,
                      queued_count = ?,
                      consecutive_failures = ?,
                      paused_reason = ?,
                      next_dispatch_at = NULL
                  WHERE id = ?`,
            args: [remainingQueued, nextConsecutiveFailures, pauseReason, bcId],
          });

          socketHub.emit("broadcast:progress", {
            broadcastId: bcId,
            status: "PAUSED",
            pausedReason: pauseReason,
          });
        } else {
          const nextStatus = remainingQueued === 0 ? "COMPLETED" : "SENDING";
          const nextDispatchIso = new Date(
            finishedAtMs + delaySec * 1000
          ).toISOString();
          await mkt.execute({
            sql: `UPDATE broadcasts
                  SET status = ?,
                      failed_count = failed_count + 1,
                      queued_count = ?,
                      consecutive_failures = ?,
                      next_dispatch_at = ?,
                      completed_at = CASE WHEN ? = 0 THEN ? ELSE completed_at END
                  WHERE id = ?`,
            args: [
              nextStatus,
              remainingQueued,
              nextConsecutiveFailures,
              remainingQueued > 0 ? nextDispatchIso : null,
              remainingQueued,
              finishedIso,
              bcId,
            ],
          });
          socketHub.emit("broadcast:progress", {
            broadcastId: bcId,
            status: nextStatus,
            queuedCount: remainingQueued,
          });
        }
      }
    }
  } finally {
    globalWorkerRunner.__ccMarketingQueueRunning = false;
  }

  return dispatchedCount;
}

export async function pauseMarketingBroadcast(
  broadcastId: string,
  reason = "Paused manually by team."
): Promise<void> {
  const mkt = getRawLibSqlClient("marketing");
  await mkt.execute({
    sql: `UPDATE broadcasts
          SET status = 'PAUSED',
              paused_reason = ?,
              next_dispatch_at = NULL
          WHERE id = ? AND status IN ('QUEUED', 'SENDING', 'SCHEDULED')`,
    args: [reason, broadcastId],
  });
  socketHub.emit("broadcast:progress", { broadcastId, status: "PAUSED" });
}

export async function resumeMarketingBroadcast(
  broadcastId: string
): Promise<void> {
  const mkt = getRawLibSqlClient("marketing");
  const nowIso = new Date().toISOString();
  const remRes = await mkt.execute({
    sql: `SELECT COUNT(*) as cnt FROM broadcast_recipients WHERE broadcast_id = ? AND status = 'QUEUED'`,
    args: [broadcastId],
  });
  const remaining = Number(remRes.rows[0]?.cnt ?? 0);
  await mkt.execute({
    sql: `UPDATE broadcasts
          SET status = ?,
              paused_reason = NULL,
              consecutive_failures = 0,
              queued_count = ?,
              next_dispatch_at = ?
          WHERE id = ?`,
    args: [
      remaining > 0 ? "SENDING" : "COMPLETED",
      remaining,
      remaining > 0 ? nowIso : null,
      broadcastId,
    ],
  });
  ensureBackgroundWorkersRunning();
  if (remaining > 0) {
    void processMarketingBroadcastQueue().catch(() => {});
  }
  socketHub.emit("broadcast:progress", { broadcastId, status: "SENDING" });
}

export async function retryFailedBroadcastRecipients(
  broadcastId: string
): Promise<number> {
  const mkt = getRawLibSqlClient("marketing");
  const nowIso = new Date().toISOString();
  await mkt.execute({
    sql: `UPDATE broadcast_recipients
          SET status = 'QUEUED',
              skip_or_error_reason = NULL,
              scheduled_at = ?
          WHERE broadcast_id = ? AND status = 'FAILED'`,
    args: [nowIso, broadcastId],
  });
  const remRes = await mkt.execute({
    sql: `SELECT COUNT(*) as cnt FROM broadcast_recipients WHERE broadcast_id = ? AND status = 'QUEUED'`,
    args: [broadcastId],
  });
  const remaining = Number(remRes.rows[0]?.cnt ?? 0);
  await mkt.execute({
    sql: `UPDATE broadcasts
          SET status = ?,
              failed_count = 0,
              queued_count = ?,
              paused_reason = NULL,
              consecutive_failures = 0,
              next_dispatch_at = ?
          WHERE id = ?`,
    args: [
      remaining > 0 ? "SENDING" : "COMPLETED",
      remaining,
      remaining > 0 ? nowIso : null,
      broadcastId,
    ],
  });
  ensureBackgroundWorkersRunning();
  if (remaining > 0) {
    void processMarketingBroadcastQueue().catch(() => {});
  }
  socketHub.emit("broadcast:progress", {
    broadcastId,
    status: remaining > 0 ? "SENDING" : "COMPLETED",
  });
  return remaining;
}

export async function cancelMarketingBroadcast(
  broadcastId: string
): Promise<void> {
  const mkt = getRawLibSqlClient("marketing");
  const nowIso = new Date().toISOString();
  await mkt.batch(
    [
      {
        sql: `UPDATE broadcast_recipients
              SET status = 'CANCELLED',
                  skip_or_error_reason = 'Campaign cancelled before sending'
              WHERE broadcast_id = ? AND status = 'QUEUED'`,
        args: [broadcastId],
      },
      {
        sql: `UPDATE broadcasts
              SET status = 'CANCELLED',
                  queued_count = 0,
                  next_dispatch_at = NULL,
                  completed_at = ?
              WHERE id = ?`,
        args: [nowIso, broadcastId],
      },
    ],
    "write"
  );
  socketHub.emit("broadcast:progress", { broadcastId, status: "CANCELLED" });
}

// ============================================================================
// MONOTONIC WHATSAPP RECEIPT PROGRESSION (SENDING -> SENT -> DELIVERED -> READ)
// ============================================================================

const RECEIPT_RANK: Record<string, number> = {
  SENDING: 0,
  QUEUED: 0,
  PENDING: 0,
  SENT: 1,
  DELIVERED: 2,
  READ: 3,
  SEEN: 3,
  PLAYED: 3,
};

function canAdvanceDeliveryStatus(currentRaw: string, nextRaw: string): boolean {
  const cur = String(currentRaw || "SENT").trim().toUpperCase();
  const next = String(nextRaw || "").trim().toUpperCase();
  if (next === "FAILED") {
    return cur !== "DELIVERED" && cur !== "READ";
  }
  if (cur === "FAILED") {
    // Allow late real delivery/read webhook to recover a transient failed mark
    return next === "DELIVERED" || next === "READ";
  }
  const curRank = RECEIPT_RANK[cur] ?? 1;
  const nextRank = RECEIPT_RANK[next] ?? -1;
  return nextRank > curRank;
}

export async function applyWhatsAppMessageReceipt(params: {
  waMessageId?: string | null;
  messageId?: string | null;
  status: "SENT" | "DELIVERED" | "READ" | "FAILED";
}): Promise<{ updated: boolean; conversationId: string | null }> {
  await ensureDatabasesBootstrapped();
  const conv = getRawLibSqlClient("conversations");
  const mkt = getRawLibSqlClient("marketing");
  const nextStatus = params.status;
  const waId = params.waMessageId ? String(params.waMessageId).trim() : "";
  const msgId = params.messageId ? String(params.messageId).trim() : "";

  let updated = false;
  let conversationId: string | null = null;
  let resolvedMsgId: string | null = msgId || null;
  let resolvedWaId: string | null = waId || null;

  if (waId || msgId) {
    const existingRes = await conv.execute(
      waId
        ? {
            sql: `SELECT id, conversation_id, delivery_status, wa_message_id
                  FROM messages
                  WHERE wa_message_id = ?
                  LIMIT 1`,
            args: [waId],
          }
        : {
            sql: `SELECT id, conversation_id, delivery_status, wa_message_id
                  FROM messages
                  WHERE id = ?
                  LIMIT 1`,
            args: [msgId],
          }
    );

    const row = existingRes.rows[0];
    if (row) {
      conversationId = String(row.conversation_id);
      resolvedMsgId = String(row.id);
      resolvedWaId = row.wa_message_id ? String(row.wa_message_id) : resolvedWaId;
      const currentStatus = String(row.delivery_status || "SENT");

      if (canAdvanceDeliveryStatus(currentStatus, nextStatus)) {
        await conv.execute({
          sql: `UPDATE messages SET delivery_status = ? WHERE id = ?`,
          args: [nextStatus, resolvedMsgId],
        });
        updated = true;
      }
    }
  }

  // Sync broadcast_recipients + broadcasts counters if this wamid belongs to a campaign
  if (resolvedWaId) {
    const recRes = await mkt.execute({
      sql: `SELECT id, broadcast_id, status
            FROM broadcast_recipients
            WHERE wa_message_id = ?
            LIMIT 1`,
      args: [resolvedWaId],
    });
    const rec = recRes.rows[0];
    if (rec) {
      const broadcastId = String(rec.broadcast_id);
      const curRecStatus = String(rec.status || "SENT");
      if (canAdvanceDeliveryStatus(curRecStatus, nextStatus)) {
        await mkt.execute({
          sql: `UPDATE broadcast_recipients SET status = ? WHERE id = ?`,
          args: [nextStatus, String(rec.id)],
        });
        await mkt.execute({
          sql: `UPDATE broadcasts
                SET delivered_count = (
                      SELECT COUNT(*) FROM broadcast_recipients
                      WHERE broadcast_id = ? AND status IN ('DELIVERED', 'READ')
                    ),
                    read_count = (
                      SELECT COUNT(*) FROM broadcast_recipients
                      WHERE broadcast_id = ? AND status = 'READ'
                    ),
                    failed_count = (
                      SELECT COUNT(*) FROM broadcast_recipients
                      WHERE broadcast_id = ? AND status = 'FAILED'
                    )
                WHERE id = ?`,
          args: [broadcastId, broadcastId, broadcastId, broadcastId],
        });
        socketHub.emit("broadcast:progress", {
          broadcastId,
          waMessageId: resolvedWaId,
          status: nextStatus,
        });
      }
    }
  }

  if (updated) {
    socketHub.emit("message:status", {
      conversationId,
      messageId: resolvedMsgId,
      waMessageId: resolvedWaId,
      status: nextStatus,
    });
  }

  return { updated, conversationId };
}

/**
 * When a customer sends an INBOUND reply in a conversation (or when testing customer read),
 * any prior OUTBOUND messages in that conversation still at SENDING/SENT/DELIVERED are marked READ.
 */
export async function markPriorOutboundMessagesRead(
  conversationId: string
): Promise<number> {
  await ensureDatabasesBootstrapped();
  const conv = getRawLibSqlClient("conversations");
  const res = await conv.execute({
    sql: `UPDATE messages
          SET delivery_status = 'READ'
          WHERE conversation_id = ?
            AND direction = 'OUTBOUND'
            AND delivery_status IN ('SENDING', 'SENT', 'DELIVERED')`,
    args: [conversationId],
  });
  const changed = Number(res.rowsAffected ?? 0);
  if (changed > 0) {
    socketHub.emit("message:status", {
      conversationId,
      status: "READ",
      markAllOutboundRead: true,
    });
  }
  return changed;
}

/**
 * In Sandbox Simulator mode, simulates authentic WhatsApp Cloud delivery progression:
 * message starts as SENT (single tick) and transitions to DELIVERED (double grey ticks) after ~1.3s.
 */
export function scheduleSandboxDeliveryReceipt(params: {
  conversationId: string;
  messageId: string;
  waMessageId: string;
  delayMs?: number;
}): void {
  const delay = Math.max(350, params.delayMs ?? 1300);
  setTimeout(() => {
    void applyWhatsAppMessageReceipt({
      messageId: params.messageId,
      waMessageId: params.waMessageId,
      status: "DELIVERED",
    }).catch(() => {});
  }, delay);
}

function getCurrentIstDateAndTime(): {
  dateKey: string;
  hour: number;
  minute: number;
} {
  const now = new Date();
  // IST = UTC + 05:30
  const istMs = now.getTime() + 5.5 * 60 * 60 * 1000;
  const ist = new Date(istMs);
  const yyyy = ist.getUTCFullYear();
  const mm = String(ist.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(ist.getUTCDate()).padStart(2, "0");
  return {
    dateKey: `${yyyy}-${mm}-${dd}`,
    hour: ist.getUTCHours(),
    minute: ist.getUTCMinutes(),
  };
}

const globalWorkerRunner = globalThis as unknown as {
  __ccBackgroundWorkersStarted?: boolean;
  __ccLastMidnightBackupDate?: string;
  __ccMarketingQueueRunning?: boolean;
};

/**
 * Idempotent in-process background daemon started automatically by the server:
 * 1. Drains safe anti-spam marketing broadcast queue every 2 seconds.
 * 2. Drains LibSQL job queues every 6 seconds.
 * 3. Checks the Midnight IST Google Drive Backup schedule every 30 seconds and triggers backup automatically!
 */
export function ensureBackgroundWorkersRunning(): void {
  if (globalWorkerRunner.__ccBackgroundWorkersStarted) return;
  globalWorkerRunner.__ccBackgroundWorkersStarted = true;

  // Initial heartbeat
  void recordWorkerHeartbeat("midnight-gdrive-scheduler", "ONLINE", 0, {
    schedule: "Daily Midnight IST (Configurable in Dev Panel)",
  });
  void drainPendingWorkerJobs();
  void processMarketingBroadcastQueue().catch(() => {});

  // Safe Paced Marketing Broadcast Queue loop (every 2 seconds)
  setInterval(() => {
    void processMarketingBroadcastQueue().catch(() => {});
  }, 2000);

  // Queue consumer loop
  setInterval(() => {
    void drainPendingWorkerJobs().catch(() => {});
  }, 6000);

  // Automatic P0 -> P1 -> P2 customer wait-time escalation loop (every 15 seconds)
  setInterval(() => {
    void checkAndEscalateWaitingChats().catch(() => {});
  }, 15000);

  // Midnight IST Google Drive Backup scheduler loop
  setInterval(async () => {
    try {
      await ensureDatabasesBootstrapped();
      const bill = getRawLibSqlClient("billing_ops");
      const res = await bill.execute(
        `SELECT * FROM backup_settings WHERE id = 'default' LIMIT 1`
      );
      const cfg = res.rows[0];
      if (!cfg || Number(cfg.enabled ?? 1) !== 1) return;

      const targetHour = Number(cfg.midnight_hour_ist ?? 0);
      const targetMinute = Number(cfg.midnight_minute_ist ?? 0);
      const { dateKey, hour, minute } = getCurrentIstDateAndTime();

      if (
        hour === targetHour &&
        minute === targetMinute &&
        globalWorkerRunner.__ccLastMidnightBackupDate !== dateKey
      ) {
        globalWorkerRunner.__ccLastMidnightBackupDate = dateKey;
        await enqueueJob("backup:midnight_gdrive", {
          triggerSource: "MIDNIGHT_CRON",
          dateKey,
        });
        await drainPendingWorkerJobs();
      }

      await recordWorkerHeartbeat("midnight-gdrive-scheduler", "ONLINE", 0, {
        configuredTimeIst: `${String(targetHour).padStart(2, "0")}:${String(
          targetMinute
        ).padStart(2, "0")} IST`,
        enabled: Number(cfg.enabled ?? 1) === 1,
      });
    } catch {
      // Non-blocking cron guard
    }
  }, 30000);
}
