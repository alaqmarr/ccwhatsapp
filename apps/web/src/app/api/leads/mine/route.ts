import { NextResponse } from "next/server";
import {
  ensureDatabasesBootstrapped,
  getRawLibSqlClient,
  parseConversationCollaborators,
} from "@cc/database";
import { hasPermission } from "@cc/rbac";
import { getCurrentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export interface MyLeadItem {
  id: string;
  sourceType: "OWNER_FORWARD" | "CALL_QUEUE" | "ASSIGNED_CHAT";
  customerName: string;
  customerPhone: string;
  sourceLabel: string;
  ownerOrAssignerName: string;
  staffId: string;
  staffName: string;
  title: string;
  body: string;
  status: string;
  priority: string;
  deliveryNote: string;
  attachmentCount: number;
  conversationId: string | null;
  callQueueId: string | null;
  createdAt: string;
}

function phoneSuffix10(raw: unknown): string {
  const digits = String(raw || "").replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : digits;
}

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  if (!hasPermission(user.role, "inbox:view", user.status)) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  await ensureDatabasesBootstrapped();
  const conv = getRawLibSqlClient("conversations");
  const auth = getRawLibSqlClient("core_auth");

  const { searchParams } = new URL(req.url);
  const wantAll =
    searchParams.get("scope") === "all" &&
    (user.role === "DEV" ||
      user.role === "SUPERADMIN" ||
      user.role === "ADMIN");

  await conv
    .execute(
      `CREATE TABLE IF NOT EXISTS lead_forwards (
        id TEXT PRIMARY KEY,
        owner_phone TEXT NOT NULL DEFAULT '',
        owner_name TEXT NOT NULL DEFAULT '',
        staff_id TEXT NOT NULL,
        staff_name TEXT NOT NULL,
        staff_phone TEXT NOT NULL DEFAULT '',
        lead_text TEXT NOT NULL,
        customer_name TEXT NOT NULL DEFAULT '',
        customer_phone TEXT NOT NULL DEFAULT '',
        call_queue_id TEXT,
        assignment_mode TEXT NOT NULL DEFAULT 'NAMED',
        delivery_status TEXT NOT NULL DEFAULT 'PENDING_WINDOW',
        delivery_note TEXT NOT NULL DEFAULT '',
        media_json TEXT NOT NULL DEFAULT '[]',
        delivered_at TEXT,
        created_at TEXT NOT NULL
      )`
    )
    .catch(() => {});

  const userRowRes = await auth
    .execute({
      sql: `SELECT whatsapp_number FROM users WHERE id = ? LIMIT 1`,
      args: [user.id],
    })
    .catch(() => ({ rows: [] as Record<string, unknown>[] }));
  const myPhoneSuffix = phoneSuffix10(userRowRes.rows[0]?.whatsapp_number);

  const [forwardsRes, callQueueRes, assignedConvsRes] = await Promise.all([
    conv
      .execute(
        `SELECT id, owner_name, staff_id, staff_name, staff_phone, lead_text,
                customer_name, customer_phone, call_queue_id, assignment_mode,
                delivery_status, delivery_note, media_json, created_at
         FROM lead_forwards
         ORDER BY created_at DESC
         LIMIT 250`
      )
      .catch(() => ({ rows: [] as Record<string, unknown>[] })),
    conv
      .execute(
        `SELECT id, customer_phone, customer_name, source, product_topic, notes,
                assignment_mode, assignment_reason, assigned_staff_id, assigned_staff_name,
                status, priority, conversation_id, submitted_by_name, created_at
         FROM call_dispatch_queue
         ORDER BY created_at DESC
         LIMIT 250`
      )
      .catch(() => ({ rows: [] as Record<string, unknown>[] })),
    conv
      .execute(
        `SELECT id, customer_phone, customer_name, smart_category, priority,
                assigned_staff_id, assigned_staff_name, assigned_team_name,
                status, last_message_preview, last_message_at, collaborators_json, created_at
         FROM conversations
         WHERE status != 'RESOLVED'
           AND assigned_staff_id IS NOT NULL
           AND assigned_staff_id != 'ACRIO'
         ORDER BY last_message_at DESC
         LIMIT 250`
      )
      .catch(() => ({ rows: [] as Record<string, unknown>[] })),
  ]);

  const convByPhone = new Map<string, string>();
  const convById = new Map<string, Record<string, unknown>>();
  for (const c of assignedConvsRes.rows) {
    const cid = String(c.id);
    convById.set(cid, c as Record<string, unknown>);
    const s = phoneSuffix10(c.customer_phone);
    if (s && !convByPhone.has(s)) {
      convByPhone.set(s, cid);
    }
  }

  const matchesCurrentUser = (staffId: string, staffPhone?: string) => {
    if (wantAll) return true;
    if (staffId && staffId === user.id) return true;
    const sfx = phoneSuffix10(staffPhone);
    return Boolean(myPhoneSuffix && sfx && myPhoneSuffix === sfx);
  };

  const leads: MyLeadItem[] = [];
  const linkedCallQueueIds = new Set<string>();
  const linkedConvIds = new Set<string>();

  for (const r of forwardsRes.rows) {
    const sid = String(r.staff_id || "");
    const sphone = String(r.staff_phone || "");
    if (!matchesCurrentUser(sid, sphone)) continue;

    const cqId = r.call_queue_id ? String(r.call_queue_id) : null;
    if (cqId) linkedCallQueueIds.add(cqId);

    const custPhone = String(r.customer_phone || "");
    const cqRow = cqId
      ? callQueueRes.rows.find((q) => String(q.id) === cqId)
      : undefined;
    const matchedConvId =
      (cqRow?.conversation_id ? String(cqRow.conversation_id) : null) ||
      convByPhone.get(phoneSuffix10(custPhone)) ||
      null;
    if (matchedConvId) linkedConvIds.add(matchedConvId);

    let attCount = 0;
    try {
      const parsedMedia = JSON.parse(String(r.media_json || "[]"));
      if (Array.isArray(parsedMedia)) attCount = parsedMedia.length;
    } catch {
      attCount = 0;
    }

    leads.push({
      id: `fw_${String(r.id)}`,
      sourceType: "OWNER_FORWARD",
      customerName:
        String(r.customer_name || "").trim() ||
        custPhone ||
        "Lead from Owner",
      customerPhone: custPhone,
      sourceLabel:
        String(r.assignment_mode || "") === "AUTO_SALES"
          ? "Owner WhatsApp (A-Z Sequence)"
          : "Owner WhatsApp",
      ownerOrAssignerName: String(r.owner_name || "Owner"),
      staffId: sid,
      staffName: String(r.staff_name || ""),
      title: cqRow?.product_topic
        ? String(cqRow.product_topic)
        : "Forwarded WhatsApp Lead",
      body: String(r.lead_text || ""),
      status: String(cqRow?.status || r.delivery_status || "ASSIGNED"),
      priority: String(cqRow?.priority || "HIGH"),
      deliveryNote: String(r.delivery_note || ""),
      attachmentCount: attCount,
      conversationId: matchedConvId,
      callQueueId: cqId,
      createdAt: String(r.created_at || new Date().toISOString()),
    });
  }

  for (const q of callQueueRes.rows) {
    const qId = String(q.id);
    if (linkedCallQueueIds.has(qId)) continue;
    const sid = q.assigned_staff_id ? String(q.assigned_staff_id) : "";
    if (!matchesCurrentUser(sid)) continue;

    const custPhone = String(q.customer_phone || "");
    const matchedConvId =
      (q.conversation_id ? String(q.conversation_id) : null) ||
      convByPhone.get(phoneSuffix10(custPhone)) ||
      null;
    if (matchedConvId) linkedConvIds.add(matchedConvId);

    leads.push({
      id: `cq_${qId}`,
      sourceType: "CALL_QUEUE",
      customerName:
        String(q.customer_name || "").trim() || custPhone || "Call Lead",
      customerPhone: custPhone,
      sourceLabel: String(q.source || "Call Dispatch Queue"),
      ownerOrAssignerName: String(q.submitted_by_name || "Desk"),
      staffId: sid,
      staffName: String(q.assigned_staff_name || ""),
      title: String(q.product_topic || "Call / Direct Lead"),
      body: String(q.notes || q.product_topic || "Assigned lead details"),
      status: String(q.status || "PENDING"),
      priority: String(q.priority || "NORMAL"),
      deliveryNote: String(q.assignment_reason || ""),
      attachmentCount: 0,
      conversationId: matchedConvId,
      callQueueId: qId,
      createdAt: String(q.created_at || new Date().toISOString()),
    });
  }

  for (const c of assignedConvsRes.rows) {
    const cid = String(c.id);
    if (linkedConvIds.has(cid)) continue;
    const sid = c.assigned_staff_id ? String(c.assigned_staff_id) : "";
    const collabs = parseConversationCollaborators(c.collaborators_json);
    const isMine =
      matchesCurrentUser(sid) ||
      (!wantAll && collabs.some((cb) => cb.staffId === user.id));
    if (!isMine) continue;

    leads.push({
      id: `conv_${cid}`,
      sourceType: "ASSIGNED_CHAT",
      customerName: String(c.customer_name || c.customer_phone || "Customer"),
      customerPhone: String(c.customer_phone || ""),
      sourceLabel: c.assigned_team_name
        ? String(c.assigned_team_name)
        : "Assigned Chat",
      ownerOrAssignerName: "Inbox Assignment",
      staffId: sid,
      staffName: String(c.assigned_staff_name || ""),
      title: String(c.smart_category || "WhatsApp Enquiry"),
      body: String(c.last_message_preview || "Assigned WhatsApp conversation"),
      status: String(c.status || "ASSIGNED"),
      priority: String(c.priority || "NORMAL"),
      deliveryNote: "",
      attachmentCount: 0,
      conversationId: cid,
      callQueueId: null,
      createdAt: String(c.last_message_at || c.created_at || new Date().toISOString()),
    });
  }

  leads.sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  const pendingCount = leads.filter(
    (l) => l.status !== "RESOLVED" && l.status !== "DELIVERED"
  ).length;

  return NextResponse.json({
    ok: true,
    scope: wantAll ? "all" : "mine",
    leads,
    summary: {
      total: leads.length,
      pendingCount,
    },
  });
}
