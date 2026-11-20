import crypto from "node:crypto";
import {
  createCallDispatchItem,
  extractGoogleMapsLinksFromText,
  getRawLibSqlClient,
  normalizeWhatsAppPhone,
  pickNextSequentialStaffAtoZ,
  recordCustomerSharedMediaBatch,
  resolveInternalStaffCallerByPhone,
  resolveStaffMemberByQuery,
  upsertSyncedContact,
  type UpsertCustomerSharedMediaInput,
} from "@cc/database";
import {
  downloadAndPersistMetaMediaToDisk,
  sendStaffClientAssignmentTemplate,
} from "@cc/connections";
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
  const poolRes = await conv
    .execute(
      `SELECT DISTINCT staff_id FROM team_members
       WHERE is_available = 1
         AND (team_id = 'team_sales' OR team_id IN (SELECT id FROM teams WHERE LOWER(name) LIKE '%sales%'))`
    )
    .catch(() => ({ rows: [] as Record<string, unknown>[] }));
  const salesIds = new Set(poolRes.rows.map((r) => String(r.staff_id)));

  const eligible = (s: DeskStaff) =>
    s.role !== "DEV" &&
    s.assignmentsEnabled &&
    s.suffix !== ownerSuffix &&
    Boolean(s.phone);
  let pool = all.filter((s) => eligible(s) && salesIds.has(s.id));
  let fromSales = true;
  if (pool.length === 0) {
    pool = all.filter(eligible);
    fromSales = false;
  }
  if (pool.length === 0) return null;

  // Strict A-to-Z sequential rotation irrespective of current load, wrapping around after the last member.
  const seqPick = await pickNextSequentialStaffAtoZ(pool, "owner_lead_assign");
  if (!seqPick) return null;
  const openNow = windowFor(windows, seqPick.chosen).open;
  const why = `${fromSales ? "from the Sales Team" : "from the active team"} in A-Z order (${
    seqPick.position
  } of ${seqPick.total}), ${openNow ? "chat unlocked" : "chat locked"}`;
  return { staff: seqPick.chosen, why };
}

export async function assignLeadFromOwner(
  parsed: ParsedAssignCommand,
  p: AssignLeadParams
): Promise<{
  handled: boolean;
  reply: string;
  assignedStaffId?: string;
  assignedStaffName?: string;
}> {
  await ensureLeadForwardsTable();
  const conv = getRawLibSqlClient("conversations");
  const ownerSuffix = suffix10(p.ownerPhone);
  const ownerE164 = normalizeWhatsAppPhone(p.ownerPhone) || p.ownerPhone;
  const callerTag = p.isStaffForwarder ? p.ownerName.split(/\s+/)[0] || p.ownerName : "sir";

  // 1. Gather everything the sender shared for this client: text, voice notes, photos, videos, files.
  let items =
    p.itemsOverride && p.itemsOverride.length > 0
      ? [...p.itemsOverride]
      : await collectLeadItems({
          conversationId: p.conversationId,
          ownerPhone: p.ownerPhone,
          replyToWaMessageId: p.replyToWaMessageId,
          isStaffForwarder: p.isStaffForwarder,
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
        `Could not find an enquiry to assign, ${callerTag}. Please paste, forward, or swipe-reply on a lead first (text, voice note, photo or file), then reply *assign* (or *assign to <name>*).`,
    };
  }

  // 2. Find the staff member.
  const [allStaff] = await Promise.all([loadDeskStaff()]);
  const windows = await loadWindowStates(allStaff);

  let chosen: DeskStaff | null = null;
  let mode: "NAMED" | "AUTO_SALES" = "NAMED";
  let whyAuto = "";
  if (p.targetStaffIdOverride) {
    chosen = allStaff.find((s) => s.id === p.targetStaffIdOverride) || null;
    if (!chosen) {
      return {
        handled: true,
        reply: `Could not find that staff account in active team members.`,
      };
    }
  } else if (parsed.targetQuery) {
    const hit = resolveStaffMemberByQuery(parsed.targetQuery, allStaff);
    chosen = hit ? allStaff.find((s) => s.id === hit.id) || null : null;
    if (!chosen) {
      if (!/^(assign|allot|reassign)$/.test(parsed.verb)) {
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
        reply: `Could not find a staff member called *${parsed.targetQuery}*, ${callerTag}. Nothing was assigned.\n\nActive staff: ${
          names || "none found"
        }.\n\nTry again with a first name, or say *assign* and I will pick the next person in A-Z sequence.`,
      };
    }
  } else {
    mode = "AUTO_SALES";
    const pick = await pickGenericStaff(allStaff, windows, ownerSuffix);
    if (!pick) {
      return {
        handled: true,
        reply:
          `Could not find any active staff member with assignments turned on and a WhatsApp number saved, ${callerTag}. Please check Team Approvals in the hub.`,
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
  const matchedForwarder = await resolveInternalStaffCallerByPhone(ownerE164).catch(() => null);
  const forwarderName = matchedForwarder?.name || p.ownerName;

  // 3. Save the lead in the Call Queue so it also shows in the hub.
  let callQueueId: string | null = null;
  let callQueueConversationId: string | null = null;
  try {
    const item = await createCallDispatchItem({
      customerPhone: hints.phone,
      customerName: hints.name,
      source: `Owner WhatsApp (${forwarderName})`,
      productTopic: (leadText || `Attachments only (${attachmentSummary})`).replace(/\s+/g, " ").slice(0, 80),
      notes: [
        leadText,
        ...mediaItems.map((i) => i.text).filter(Boolean).map((c) => `(File caption: ${c})`),
        attachmentSummary ? `(Attachments saved to Client Panel: ${attachmentSummary}.)` : "",
      ]
        .filter(Boolean)
        .join("\n"),
      assignmentMode: "MANUAL",
      manualStaffId: chosen.id,
      priority: "HIGH",
      submittedById: p.ownerPhone,
      submittedByName: forwarderName,
    });
    callQueueId = item.id;
    callQueueConversationId = item.conversationId || null;
  } catch (err) {
    console.warn("[owner-desk] call queue save failed:", err);
  }

  // 4. Route/create the client conversation for hints.phone AND permanently tag all shared media & locations to hints.phone.
  let reassignedFrom = "";
  if (hints.phone) {
    await upsertSyncedContact({
      phone: hints.phone,
      name: hints.name || undefined,
      source: "MANUAL",
      notes: `Lead from ${forwarderName}: ${leadText.slice(0, 300)}`,
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
    let clientConvId = ex ? String(ex.id) : "";

    if (!ex) {
      clientConvId = `conv_${crypto.randomUUID().slice(0, 8)}`;
      const crm = getRawLibSqlClient("crm_orders");
      const custRes = await crm
        .execute({
          sql: `SELECT id FROM customers WHERE phone = ? LIMIT 1`,
          args: [hints.phone],
        })
        .catch(() => ({ rows: [] as Record<string, unknown>[] }));
      const custId = custRes.rows[0]?.id ? String(custRes.rows[0].id) : null;
      await conv
        .execute({
          sql: `INSERT INTO conversations (
            id, customer_phone, customer_name, customer_id, status, priority, smart_category,
            assigned_staff_id, assigned_staff_name, assigned_team_id, assigned_team_name,
            escalation_level, waiting_since, unread_count, last_message_preview, last_message_at, created_at
          ) VALUES (?, ?, ?, ?, 'ASSIGNED', 'HIGH', 'General Enquiry', ?, ?, 'team_sales', 'Sales Team', 'P0', NULL, 0, ?, ?, ?)`,
          args: [
            clientConvId,
            hints.phone,
            hints.name || hints.phone,
            custId,
            chosen.id,
            chosen.name,
            (leadText || attachmentSummary || `Lead forwarded by ${forwarderName}`).slice(0, 140),
            nowIso,
            nowIso,
          ],
        })
        .catch((err) => {
          console.warn("[owner-desk] client conversation insert failed:", err);
        });
      await p
        .logAssignment({
          conversationId: clientConvId,
          customerPhone: hints.phone,
          customerName: hints.name || hints.phone,
          fromStaffId: null,
          fromStaffName: null,
          fromTeamName: null,
          toStaffId: chosen.id,
          toStaffName: chosen.name,
          toTeamId: "team_sales",
          toTeamName: "Sales Team",
          escalationLevel: "P0",
          assignmentSource: "MANUAL_ASSIGN",
          assignedByName: forwarderName,
          reason: `Lead forwarded by ${forwarderName} on WhatsApp`,
          assignedAt: nowIso,
        })
        .catch(() => {});
    } else if (String(ex.status) !== "RESOLVED" && String(ex.assigned_staff_id || "") !== chosen.id) {
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
        args: [chosen.id, chosen.name, clientConvId],
      });
      await p
        .logAssignment({
          conversationId: clientConvId,
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
          assignedByName: forwarderName,
          reason: `Assigned by ${forwarderName} on WhatsApp (lead forwarding)`,
          assignedAt: nowIso,
        })
        .catch(() => {});
      if (prevId && prevId !== "ACRIO" && prevId !== chosen.id) {
        reassignedFrom = prevName;
        await createNotification({
          staffId: prevId,
          type: "MENTION",
          conversationId: clientConvId,
          messageId: leadId,
          fromName: forwarderName,
          customerName: String(ex.customer_name || hints.phone),
          text: `${forwarderName} moved this chat to ${chosen.name}. You no longer need to follow it up.`,
        }).catch(() => {});
      }
      socketHub.emit("conversation:assigned", {
        conversationId: clientConvId,
        staffId: chosen.id,
        staffName: chosen.name,
        teamName: "Sales Team",
        escalationLevel: "P0",
      });
    }

    if (clientConvId) {
      callQueueConversationId = clientConvId;
      if (callQueueId) {
        await conv
          .execute({
            sql: `UPDATE call_dispatch_queue SET conversation_id = COALESCE(conversation_id, ?) WHERE id = ?`,
            args: [clientConvId, callQueueId],
          })
          .catch(() => {});
      }
      const noteLines = [
        `${forwarderName} assigned this lead to ${chosen.name} on WhatsApp.`,
        leadText ? `Context: ${leadText.slice(0, 500)}` : "",
        attachmentSummary
          ? `Shared items saved to Client Panel (${attachmentSummary}).`
          : "",
      ].filter(Boolean);
      await conv
        .execute({
          sql: `INSERT INTO messages (id, conversation_id, direction, sender_type, sender_name, message_type, billing_category, body, delivery_status, created_at)
                VALUES (?, ?, 'INTERNAL', 'STAFF_NOTE', ?, 'INTERNAL_NOTE', 'INTERNAL', ?, 'SAVED', ?)`,
          args: [
            `msg_lead_note_${crypto.randomUUID().slice(0, 8)}`,
            clientConvId,
            forwarderName,
            noteLines.join("\n"),
            nowIso,
          ],
        })
        .catch(() => {});
    }

    // Tag EVERY photo, video, file, voice note, and location to hints.phone in customer_shared_media + disk vault
    const leadContextSnippet = leadText.slice(0, 600);
    const vaultBatch: UpsertCustomerSharedMediaInput[] = [];
    for (const m of mediaItems) {
      if (m.kind === "LOCATION") {
        vaultBatch.push({
          customerPhone: hints.phone,
          conversationId: clientConvId || null,
          itemKind: "LOCATION",
          title: m.locationName || "Shared Location",
          caption: m.text || "",
          latitude: m.latitude ?? null,
          longitude: m.longitude ?? null,
          locationAddress: m.locationAddress || "",
          mapsUrl: m.mapsUrl || "",
          sourceType: "OWNER_FORWARD",
          sourceLabel: `Forwarded by ${forwarderName}`,
          receivedViaPhone: ownerE164,
          receivedViaName: forwarderName,
          assignedStaffId: chosen.id,
          assignedStaffName: chosen.name,
          leadContext: leadContextSnippet,
          createdAt: new Date(m.at || Date.now()).toISOString(),
        });
      } else if (m.kind !== "TEXT" && m.mediaId) {
        vaultBatch.push({
          customerPhone: hints.phone,
          conversationId: clientConvId || null,
          waMediaId: m.mediaId,
          localMediaId: m.mediaId,
          itemKind: m.kind,
          title: m.fileName || m.kind,
          caption: m.text || "",
          mimeType: m.mimeType || "",
          sourceType: "OWNER_FORWARD",
          sourceLabel: `Forwarded by ${forwarderName}`,
          receivedViaPhone: ownerE164,
          receivedViaName: forwarderName,
          assignedStaffId: chosen.id,
          assignedStaffName: chosen.name,
          leadContext: leadContextSnippet,
          createdAt: new Date(m.at || Date.now()).toISOString(),
        });
        void downloadAndPersistMetaMediaToDisk({
          mediaId: m.mediaId,
          customerPhone: hints.phone,
          fileName: m.fileName,
          mimeType: m.mimeType,
          sourceLabel: `Forwarded by ${forwarderName}`,
        }).catch(() => {});
      }
    }
    for (const link of extractGoogleMapsLinksFromText(leadText)) {
      vaultBatch.push({
        customerPhone: hints.phone,
        conversationId: clientConvId || null,
        itemKind: "LOCATION",
        title: "Shared Map Link",
        caption: "",
        latitude: link.latitude,
        longitude: link.longitude,
        mapsUrl: link.mapsUrl,
        sourceType: "OWNER_FORWARD",
        sourceLabel: `Forwarded by ${forwarderName}`,
        receivedViaPhone: ownerE164,
        receivedViaName: forwarderName,
        assignedStaffId: chosen.id,
        assignedStaffName: chosen.name,
        leadContext: leadContextSnippet,
        createdAt: nowIso,
      });
    }
    if (vaultBatch.length > 0) {
      await recordCustomerSharedMediaBatch(vaultBatch).catch(() => {});
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

  // 6. Confirmation back to the forwarder.
  const lines: string[] = [];
  lines.push(`Done, ${callerTag}. Lead assigned to *${chosen.name}*${chosen.department ? ` (${chosen.department})` : ""}.`);
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
      `${staffFirst} has no WhatsApp number saved, so I could not message them. The lead is saved in the Call Queue & MY LEADS: ${p.hubBase}/dashboard/call-queue`
    );
  } else {
    lines.push(`I could not reach ${staffFirst} on WhatsApp. The lead is saved in the Call Queue & MY LEADS: ${p.hubBase}/dashboard/call-queue`);
  }
  if (hints.phone) lines.push(`Customer number found in the text: ${hints.phone}.`);
  if (reassignedFrom) lines.push(`This customer's open chat was moved from ${reassignedFrom} to ${staffFirst}.`);
  return {
    handled: true,
    reply: lines.join("\n"),
    assignedStaffId: chosen.id,
    assignedStaffName: chosen.name,
  };
}
