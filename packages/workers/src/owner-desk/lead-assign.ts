import crypto from "node:crypto";
import {
  createCallDispatchItem,
  getRawLibSqlClient,
  normalizeWhatsAppPhone,
  resolveStaffMemberByQuery,
  upsertSyncedContact,
} from "@cc/database";
import { sendStaffClientAssignmentTemplate } from "@cc/connections";
import { socketHub } from "@cc/sockets";
import { createNotification } from "@cc/workers/staff-notes";
import {
  ensureLeadForwardsTable,
  loadDeskStaff,
  loadWindowStates,
  windowFor,
} from "./desk-data";
import { extractCustomerHints, MEDIA_PLACEHOLDER_RE } from "./identity-and-parse";
import {
  collectLeadItems,
  deliverLeadBundle,
  describeAttachments,
  leadTextOf,
} from "./lead-delivery";
import {
  suffix10,
  todayStartIso,
  type AssignLeadParams,
  type DeskStaff,
  type ParsedAssignCommand,
  type WindowState,
} from "./types";

async function pickGenericStaff(
  all: DeskStaff[],
  windows: Map<string, WindowState>,
  ownerSuffix: string
): Promise<{ staff: DeskStaff; why: string } | null> {
  const conv = getRawLibSqlClient("conversations");
  const [poolRes, loadRes, leadRes] = await Promise.all([
    conv
      .execute(
        `SELECT DISTINCT staff_id FROM team_members
         WHERE is_available = 1
           AND (team_id = 'team_sales' OR team_id IN (SELECT id FROM teams WHERE LOWER(name) LIKE '%sales%'))`
      )
      .catch(() => ({ rows: [] as Record<string, unknown>[] })),
    conv.execute(
      `SELECT assigned_staff_id AS sid, COUNT(*) AS c FROM conversations
       WHERE status != 'RESOLVED' AND assigned_staff_id IS NOT NULL AND assigned_staff_id != 'ACRIO'
       GROUP BY assigned_staff_id`
    ),
    conv
      .execute({
        sql: `SELECT staff_id AS sid, COUNT(*) AS c FROM lead_forwards WHERE created_at >= ? GROUP BY staff_id`,
        args: [todayStartIso()],
      })
      .catch(() => ({ rows: [] as Record<string, unknown>[] })),
  ]);
  const salesIds = new Set(poolRes.rows.map((r) => String(r.staff_id)));
  const load = new Map<string, number>();
  for (const r of loadRes.rows) load.set(String(r.sid), Number(r.c ?? 0));
  const leadsToday = new Map<string, number>();
  for (const r of leadRes.rows) leadsToday.set(String(r.sid), Number(r.c ?? 0));

  const eligible = (s: DeskStaff) => s.role !== "DEV" && s.suffix !== ownerSuffix && Boolean(s.phone);
  let pool = all.filter((s) => eligible(s) && salesIds.has(s.id));
  let fromSales = true;
  if (pool.length === 0) {
    pool = all.filter(eligible);
    fromSales = false;
  }
  if (pool.length === 0) return null;

  const scored = pool
    .map((s) => ({
      s,
      open: windowFor(windows, s).open ? 0 : 1,
      load: (load.get(s.id) ?? 0) + (leadsToday.get(s.id) ?? 0),
      tie: Math.random(),
    }))
    .sort((a, b) => a.open - b.open || a.load - b.load || a.tie - b.tie);
  const best = scored[0];
  const openNow = best.open === 0;
  const why = `${fromSales ? "from the Sales Team" : "from the active team"}, ${
    openNow ? "chat unlocked" : "chat locked"
  }, ${best.load} current ${best.load === 1 ? "chat or lead" : "chats and leads"}`;
  return { staff: best.s, why };
}

export async function assignLeadFromOwner(
  parsed: ParsedAssignCommand,
  p: AssignLeadParams
): Promise<{ handled: boolean; reply: string }> {
  await ensureLeadForwardsTable();
  const conv = getRawLibSqlClient("conversations");
  const ownerSuffix = suffix10(p.ownerPhone);
  const ownerE164 = normalizeWhatsAppPhone(p.ownerPhone) || p.ownerPhone;

  // 1. Gather everything the owner sent for this client: text, voice notes, photos, videos, files.
  let items = await collectLeadItems({
    conversationId: p.conversationId,
    ownerPhone: p.ownerPhone,
    replyToWaMessageId: p.replyToWaMessageId,
  });
  if (items.length === 0 && parsed.leadText.trim()) {
    // Fallback for a message that is not yet in the chat log.
    const typed = parsed.leadText
      .split("\n")
      .filter((l) => !MEDIA_PLACEHOLDER_RE.test(l.trim()))
      .join("\n")
      .trim();
    if (typed) items = [{ kind: "TEXT", text: typed, at: Date.now() }];
  }
  items = items.map((i) => ({
    ...i,
    text: i.text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").slice(0, 3500),
  }));
  const leadText = leadTextOf(items);
  const mediaItems = items.filter((i) => i.kind !== "TEXT");
  const attachmentSummary = describeAttachments(items);
  if (!leadText && mediaItems.length === 0) {
    return {
      handled: true,
      reply:
        "Sir, I could not find an enquiry to assign. Please paste or forward the enquiry first (text, voice note, photo or file), then say *please assign to <name>* (or just *please assign*). You can also swipe-reply on the enquiry and type the command.",
    };
  }

  // 2. Find the staff member.
  const [allStaff] = await Promise.all([loadDeskStaff()]);
  const windows = await loadWindowStates(allStaff);

  let chosen: DeskStaff | null = null;
  let mode: "NAMED" | "AUTO_SALES" = "NAMED";
  let whyAuto = "";
  if (parsed.targetQuery) {
    const hit = resolveStaffMemberByQuery(parsed.targetQuery, allStaff);
    chosen = hit ? allStaff.find((s) => s.id === hit.id) || null : null;
    if (!chosen) {
      if (!/^(assign|allot)$/.test(parsed.verb)) {
        // "send this to <something that is not a staff name>" is not an assignment command.
        return { handled: false, reply: "" };
      }
      const names = allStaff
        .filter((s) => s.role !== "DEV" && s.suffix !== ownerSuffix)
        .slice(0, 12)
        .map((s) => s.name.split(/\s+/)[0])
        .join(", ");
      return {
        handled: true,
        reply: `Sir, I could not find a staff member called *${parsed.targetQuery}*. Nothing was assigned.\n\nActive staff: ${
          names || "none found"
        }.\n\nTry again with a first name, or say *please assign* and I will pick someone from the Sales Team.`,
      };
    }
  } else {
    mode = "AUTO_SALES";
    const pick = await pickGenericStaff(allStaff, windows, ownerSuffix);
    if (!pick) {
      return {
        handled: true,
        reply:
          "Sir, I could not find any active staff member with a WhatsApp number saved, so nothing was assigned. Please check the team list in the hub.",
      };
    }
    chosen = pick.staff;
    whyAuto = pick.why;
  }

  const win = windowFor(windows, chosen);
  const hints = extractCustomerHints(
    items.map((i) => i.text).filter(Boolean).join("\n"),
    [ownerSuffix, chosen.suffix]
  );
  const nowIso = new Date().toISOString();
  const leadId = `lead_${crypto.randomUUID().slice(0, 10)}`;
  const staffFirst = chosen.name.split(/\s+/)[0] || chosen.name;

  // 3. Save the lead in the Call Queue so it also shows in the hub.
  let callQueueId: string | null = null;
  let callQueueConversationId: string | null = null;
  try {
    const item = await createCallDispatchItem({
      customerPhone: hints.phone,
      customerName: hints.name,
      source: `Owner WhatsApp (${p.ownerName})`,
      productTopic: (leadText || `Attachments only (${attachmentSummary})`).replace(/\s+/g, " ").slice(0, 80),
      notes: [
        leadText,
        ...mediaItems.map((i) => i.text).filter(Boolean).map((c) => `(File caption: ${c})`),
        attachmentSummary ? `(Attachments: ${attachmentSummary}. Open the owner chat in the hub to view them.)` : "",
      ]
        .filter(Boolean)
        .join("\n"),
      assignmentMode: "MANUAL",
      manualStaffId: chosen.id,
      priority: "HIGH",
      submittedById: p.ownerPhone,
      submittedByName: p.ownerName,
    });
    callQueueId = item.id;
    callQueueConversationId = item.conversationId || null;
  } catch (err) {
    console.warn("[owner-desk] call queue save failed:", err);
  }

  // 4. If the customer already has an open chat, move it to the chosen staff member.
  let reassignedFrom = "";
  if (hints.phone) {
    await upsertSyncedContact({
      phone: hints.phone,
      name: hints.name || undefined,
      source: "MANUAL",
      notes: `Lead from ${p.ownerName}: ${leadText.slice(0, 300)}`,
      preferredStaffId: chosen.id,
      preferredStaffName: chosen.name,
      lastContactedAt: nowIso,
    }).catch(() => {});

    const existing = await conv
      .execute({
        sql: `SELECT id, customer_name, assigned_staff_id, assigned_staff_name, assigned_team_name, status
              FROM conversations WHERE customer_phone = ? LIMIT 1`,
        args: [hints.phone],
      })
      .catch(() => ({ rows: [] as Record<string, unknown>[] }));
    const ex = existing.rows[0];
    if (ex && String(ex.status) !== "RESOLVED" && String(ex.assigned_staff_id || "") !== chosen.id) {
      const prevId = ex.assigned_staff_id ? String(ex.assigned_staff_id) : "";
      const prevName = ex.assigned_staff_name ? String(ex.assigned_staff_name) : "";
      await conv.execute({
        sql: `UPDATE conversations
              SET status = 'ASSIGNED', assigned_staff_id = ?, assigned_staff_name = ?,
                  assigned_team_id = COALESCE(assigned_team_id, 'team_sales'),
                  assigned_team_name = CASE
                    WHEN assigned_team_name IS NULL OR TRIM(assigned_team_name) = '' OR assigned_team_name LIKE 'System (ACRIO)%' OR assigned_team_name = 'Internal Team Desk'
                    THEN 'Sales Team' ELSE assigned_team_name END,
                  escalation_level = 'P0', waiting_since = NULL
              WHERE id = ?`,
        args: [chosen.id, chosen.name, String(ex.id)],
      });
      await p
        .logAssignment({
          conversationId: String(ex.id),
          customerPhone: hints.phone,
          customerName: String(ex.customer_name || hints.name || ""),
          fromStaffId: prevId || null,
          fromStaffName: prevName || null,
          fromTeamName: ex.assigned_team_name ? String(ex.assigned_team_name) : null,
          toStaffId: chosen.id,
          toStaffName: chosen.name,
          toTeamId: "team_sales",
          toTeamName: "Sales Team",
          escalationLevel: "P0",
          assignmentSource: "MANUAL_ASSIGN",
          assignedByName: p.ownerName,
          reason: `Assigned by ${p.ownerName} on WhatsApp (lead forwarding)`,
          assignedAt: nowIso,
        })
        .catch(() => {});
      await conv
        .execute({
          sql: `INSERT INTO messages (id, conversation_id, direction, sender_type, sender_name, message_type, billing_category, body, delivery_status, created_at)
                VALUES (?, ?, 'INTERNAL', 'STAFF_NOTE', ?, 'INTERNAL_NOTE', 'INTERNAL', ?, 'SAVED', ?)`,
          args: [
            `msg_lead_note_${crypto.randomUUID().slice(0, 8)}`,
            String(ex.id),
            p.ownerName,
            `${p.ownerName} assigned this chat to ${chosen.name} on WhatsApp.`,
            nowIso,
          ],
        })
        .catch(() => {});
      if (prevId && prevId !== "ACRIO" && prevId !== chosen.id) {
        reassignedFrom = prevName;
        await createNotification({
          staffId: prevId,
          type: "MENTION",
          conversationId: String(ex.id),
          messageId: leadId,
          fromName: p.ownerName,
          customerName: String(ex.customer_name || hints.phone),
          text: `${p.ownerName} moved this chat to ${chosen.name}. You no longer need to follow it up.`,
        }).catch(() => {});
      }
      socketHub.emit("conversation:assigned", {
        conversationId: String(ex.id),
        staffId: chosen.id,
        staffName: chosen.name,
        teamName: "Sales Team",
        escalationLevel: "P0",
      });
    }
  }

  // 5. Deliver to the staff member.
  let deliveryStatus: "DELIVERED" | "PENDING_WINDOW" | "NO_WHATSAPP" | "FAILED" = "PENDING_WINDOW";
  let deliveryNote = "";
  const hubLink = callQueueConversationId
    ? `${p.hubBase}/dashboard/inbox?chat=${encodeURIComponent(callQueueConversationId)}`
    : `${p.hubBase}/dashboard/call-queue`;
  const storedLeadText = leadText || "(attachments only)";
  let attachmentFailures: string[] = [];

  if (!chosen.phone) {
    deliveryStatus = "NO_WHATSAPP";
    deliveryNote = "Staff member has no WhatsApp number saved";
  } else if (win.open && win.conversationId) {
    const out = await deliverLeadBundle({
      staffPhone: chosen.phone,
      conversationId: win.conversationId,
      staffFirstName: staffFirst,
      ownerName: p.ownerName,
      leadText,
      items,
      customerName: hints.name,
      customerPhone: hints.phone,
      createdAt: nowIso,
      hubLink,
    });
    if (out.ok) {
      deliveryStatus = "DELIVERED";
      attachmentFailures = out.attachmentsFailed;
      deliveryNote = attachmentFailures.length
        ? `Sent as chat text. Could not forward: ${attachmentFailures.join(", ")}`
        : "Sent as chat text (chat was unlocked)";
    } else {
      deliveryStatus = "PENDING_WINDOW";
      deliveryNote = `Chat send failed (${out.error || "unknown"}), will retry when staff messages the desk`;
    }
  } else {
    deliveryNote = "Chat was locked, template sent, full lead waits for the staff reply";
    if (String(process.env.OWNER_LEAD_TEMPLATE_FALLBACK ?? "1") !== "0") {
      const tpl = await sendStaffClientAssignmentTemplate({
        toPhone: chosen.phone,
        staffId: chosen.id,
        staffName: chosen.name,
        customerName: hints.name || "New enquiry from the owner",
        customerPhone: hints.phone || "Reply Hi to see details",
      }).catch(() => ({ ok: false as const, error: "template failed" }));
      if (!tpl.ok) deliveryNote += ` (template did not send: ${"error" in tpl && tpl.error ? tpl.error : "unknown"})`;
    }
  }

  await conv.execute({
    sql: `INSERT INTO lead_forwards (
      id, owner_phone, owner_name, staff_id, staff_name, staff_phone, lead_text, customer_name, customer_phone,
      call_queue_id, assignment_mode, delivery_status, delivery_note, delivered_at, created_at, media_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      leadId,
      ownerE164,
      p.ownerName,
      chosen.id,
      chosen.name,
      chosen.phone,
      storedLeadText,
      hints.name,
      hints.phone,
      callQueueId,
      mode,
      deliveryStatus,
      deliveryNote,
      deliveryStatus === "DELIVERED" ? nowIso : null,
      nowIso,
      JSON.stringify(mediaItems),
    ],
  });

  await createNotification({
    staffId: chosen.id,
    type: "CALLBACK",
    conversationId: callQueueConversationId || "/dashboard/call-queue",
    messageId: leadId,
    fromName: p.ownerName,
    customerName: hints.name || hints.phone || "New lead",
    text: `Lead from ${p.ownerName}: ${(leadText || `attachments only (${attachmentSummary})`).replace(/\s+/g, " ").slice(0, 160)}`,
  }).catch(() => {});
  socketHub.emit("call_queue:updated", { id: callQueueId, action: "created" });

  // 6. Confirmation back to the owner.
  const lines: string[] = [];
  lines.push(`Done, sir. Lead assigned to *${chosen.name}*${chosen.department ? ` (${chosen.department})` : ""}.`);
  if (mode === "AUTO_SALES") lines.push(`I picked ${staffFirst} ${whyAuto}.`);
  lines.push("");
  const packed = [leadText ? "the written enquiry" : "", attachmentSummary].filter(Boolean).join(" + ");
  if (deliveryStatus === "DELIVERED") {
    lines.push(`${staffFirst} has received the full enquiry on WhatsApp (${packed || "text"}).`);
    if (attachmentFailures.length > 0) {
      lines.push(
        `Heads up: ${attachmentFailures.length === 1 ? "one attachment" : `${attachmentFailures.length} attachments`} could not be forwarded (${attachmentFailures.join(", ")}). ${staffFirst} was told, and can open it in the hub.`
      );
    }
  } else if (deliveryStatus === "PENDING_WINDOW") {
    lines.push(
      `${staffFirst}'s chat is locked because there was no *hi* in the last 24 hours. I sent the alert template. The full enquiry (${packed || "text"}) will reach ${staffFirst} the moment ${staffFirst} messages this number.`
    );
  } else if (deliveryStatus === "NO_WHATSAPP") {
    lines.push(
      `${staffFirst} has no WhatsApp number saved, so I could not message them. The lead is saved in the Call Queue: ${p.hubBase}/dashboard/call-queue`
    );
  } else {
    lines.push(`I could not reach ${staffFirst} on WhatsApp. The lead is saved in the Call Queue: ${p.hubBase}/dashboard/call-queue`);
  }
  if (hints.phone) lines.push(`Customer number found in the text: ${hints.phone}.`);
  if (reassignedFrom) lines.push(`This customer's open chat was moved from ${reassignedFrom} to ${staffFirst}.`);
  return { handled: true, reply: lines.join("\n") };
}
