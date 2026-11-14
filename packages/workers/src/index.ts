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
  const isHandledByAcrio =
    params.isNewConversation || !currentAssignedId || currentAssignedId === "ACRIO";

  const rulesRes = await conv.execute(
    `SELECT * FROM automations WHERE is_enabled = 1`
  );
  const lower = params.inboundText.toLowerCase();
  const nowIso = new Date().toISOString();

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
                assigned_team_name = 'ACRIO Assistant',
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

async function executeBroadcastJob(payload: Record<string, unknown>): Promise<void> {
  const broadcastId = String(payload.broadcastId || "");
  if (!broadcastId) return;

  const mkt = getRawLibSqlClient("marketing");
  const bcRes = await mkt.execute({
    sql: `SELECT * FROM broadcasts WHERE id = ? LIMIT 1`,
    args: [broadcastId],
  });
  if (!bcRes.rows[0]) return;
  const bc = bcRes.rows[0] as Record<string, unknown>;

  const listRes = await mkt.execute({
    sql: `SELECT * FROM marketing_lists WHERE id = ? LIMIT 1`,
    args: [String(bc.list_id)],
  });
  const tplRes = await mkt.execute({
    sql: `SELECT * FROM templates WHERE id = ? LIMIT 1`,
    args: [String(bc.template_id)],
  });

  let phones: string[] = [];
  try {
    phones = JSON.parse(String(listRes.rows[0]?.member_phones_json || "[]"));
  } catch {
    phones = [];
  }

  const tplName = String(tplRes.rows[0]?.name || bc.template_name || "");
  const tplBody = String(tplRes.rows[0]?.body_text || "Hello from Classic Concepts!");
  const category = (String(bc.billing_category || "MARKETING") as BillingMessageCategory);

  let sent = 0;
  let delivered = 0;
  let totalClientBilled = 0;
  let totalMetaCost = 0;

  for (const phone of phones) {
    const out = await sendWhatsAppCloudMessage({
      toPhone: phone,
      bodyText: tplBody,
      templateName: tplName,
    });
    if (out.ok) {
      sent++;
      if (out.deliveryStatus === "DELIVERED" || out.deliveryStatus === "SENT") {
        delivered++;
      }
      const billed = await recordDualPricingLedgerEntry({
        broadcastId,
        customerPhone: phone,
        category,
        staffName: `Broadcast: ${String(bc.name)}`,
      });
      totalClientBilled += billed.clientUnitRateInr;
      totalMetaCost += billed.actualMetaUnitCostInr;
    }
  }

  await mkt.execute({
    sql: `UPDATE broadcasts
          SET status = 'COMPLETED',
              sent_count = ?,
              delivered_count = ?,
              client_billed_inr = ?,
              actual_meta_cost_inr = ?
          WHERE id = ?`,
    args: [
      sent,
      delivered,
      Number(totalClientBilled.toFixed(2)),
      Number(totalMetaCost.toFixed(4)),
      broadcastId,
    ],
  });

  socketHub.emit("broadcast:progress", {
    broadcastId,
    status: "COMPLETED",
    sent,
    delivered,
  });
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
};

/**
 * Idempotent in-process background daemon started automatically by the server:
 * 1. Drains LibSQL job queues every 6 seconds.
 * 2. Checks the Midnight IST Google Drive Backup schedule every 30 seconds and triggers backup automatically!
 */
export function ensureBackgroundWorkersRunning(): void {
  if (globalWorkerRunner.__ccBackgroundWorkersStarted) return;
  globalWorkerRunner.__ccBackgroundWorkersStarted = true;

  // Initial heartbeat
  void recordWorkerHeartbeat("midnight-gdrive-scheduler", "ONLINE", 0, {
    schedule: "Daily Midnight IST (Configurable in Dev Panel)",
  });
  void drainPendingWorkerJobs();

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
