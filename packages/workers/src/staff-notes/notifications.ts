import crypto from "node:crypto";
import { ensureDatabasesBootstrapped, getRawLibSqlClient } from "@cc/database";
import {
  sendCallbackRequestAlertTemplate,
  sendStaffAlertEmail,
  sendStaffWhatsAppAlert,
} from "@cc/connections";
import { socketHub } from "@cc/sockets";
import type { MentionableStaff, StaffNotification } from "./types";

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

let tableReady = false;
export async function ensureStaffNotificationsTable(): Promise<void> {
  if (tableReady) return;
  await ensureDatabasesBootstrapped();
  const conv = getRawLibSqlClient("conversations");
  await conv.execute(`CREATE TABLE IF NOT EXISTS staff_notifications (
    id TEXT PRIMARY KEY,
    staff_id TEXT NOT NULL,
    type TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    message_id TEXT NOT NULL DEFAULT '',
    from_name TEXT NOT NULL DEFAULT '',
    customer_name TEXT NOT NULL DEFAULT '',
    text TEXT NOT NULL DEFAULT '',
    is_read INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  )`);
  await conv.execute(
    `CREATE INDEX IF NOT EXISTS idx_staff_notif_staff ON staff_notifications (staff_id, is_read, created_at)`
  );
  tableReady = true;
}

/**
 * Finds "@Name" mentions of teammates and "@ACRIO" in a note.
 * Matches full names first, then a unique first name, then the email name before the @.
 */
export function parseNoteMentions(
  text: string,
  staff: MentionableStaff[]
): { mentions: MentionableStaff[]; askAcrio: boolean } {
  const lead = "(^|[\\s(,.;:!?])";
  const tail = "(?![A-Za-z0-9_])";
  const askAcrio = new RegExp(`${lead}@acrio${tail}`, "i").test(text);

  const firstNameCounts = new Map<string, number>();
  for (const s of staff) {
    const first = s.name.trim().split(/\s+/)[0]?.toLowerCase();
    if (first) firstNameCounts.set(first, (firstNameCounts.get(first) || 0) + 1);
  }

  const found = new Map<string, MentionableStaff>();
  const byLongestName = [...staff].sort((a, b) => b.name.length - a.name.length);
  let remaining = text;
  for (const s of byLongestName) {
    const candidates: string[] = [s.name.trim()];
    const first = s.name.trim().split(/\s+/)[0];
    if (first && (firstNameCounts.get(first.toLowerCase()) || 0) === 1) candidates.push(first);
    const emailName = (s.email || "").split("@")[0];
    if (emailName) candidates.push(emailName);
    for (const c of candidates) {
      const re = new RegExp(`${lead}@${escapeRe(c)}${tail}`, "i");
      if (re.test(remaining)) {
        found.set(s.id, s);
        // Remove it so a shorter name inside a longer one is not matched twice.
        remaining = remaining.replace(new RegExp(`@${escapeRe(c)}${tail}`, "ig"), " ");
        break;
      }
    }
  }
  return { mentions: Array.from(found.values()), askAcrio };
}

export async function createNotification(params: {
  staffId: string;
  type: StaffNotification["type"];
  conversationId: string;
  messageId: string;
  fromName: string;
  customerName: string;
  text: string;
}): Promise<void> {
  await ensureStaffNotificationsTable();
  const conv = getRawLibSqlClient("conversations");
  const createdAt = new Date().toISOString();
  await conv.execute({
    sql: `INSERT INTO staff_notifications (id, staff_id, type, conversation_id, message_id, from_name, customer_name, text, is_read, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
    args: [
      `ntf_${crypto.randomUUID().slice(0, 10)}`,
      params.staffId,
      params.type,
      params.conversationId,
      params.messageId,
      params.fromName,
      params.customerName,
      params.text.slice(0, 400),
      createdAt,
    ],
  });
  socketHub.emit("staff:mention", {
    staffId: params.staffId,
    type: params.type,
    conversationId: params.conversationId,
    fromName: params.fromName,
    customerName: params.customerName,
    text: params.text.slice(0, 200),
  });
}

/** Emails (and optionally WhatsApps) a teammate. Never throws and never blocks the caller. */
export async function alertStaffOutsideApp(params: {
  staff: MentionableStaff;
  type: "STAFF_MENTION" | "STAFF_CALLBACK";
  subject: string;
  headline: string;
  detail: string;
  conversationId: string;
}): Promise<void> {
  try {
    if (params.staff.email) {
      await sendStaffAlertEmail({
        staffId: params.staff.id,
        staffEmail: params.staff.email,
        staffName: params.staff.name,
        subject: params.subject,
        headline: params.headline,
        detail: params.detail,
        conversationId: params.conversationId,
        ctaLabel: params.type === "STAFF_CALLBACK" ? "Open the chat" : "Open chat",
        dispatchType: params.type,
      });
    }
    if (params.staff.whatsappNumber) {
      await sendStaffWhatsAppAlert({
        toPhone: params.staff.whatsappNumber,
        staffName: params.staff.name,
        headline: params.headline,
        detail: params.detail,
      });
    }
  } catch (err) {
    console.warn("[notify] staff alert failed:", (err as Error)?.message || err);
  }
}

/** Tells the assigned sales handler (or single least-loaded sales member if unassigned) about a new callback request. */
export async function notifyCallbackRequest(params: {
  conversationId: string;
  customerName: string;
  customerPhone: string;
  slot: string;
  topic: string;
  requestId: string;
}): Promise<void> {
  try {
    await ensureDatabasesBootstrapped();
    const conv = getRawLibSqlClient("conversations");
    const auth = getRawLibSqlClient("core_auth");

    // 1. If the chat is already assigned to a specific human teammate, notify ONLY them.
    const convRes = await conv
      .execute({
        sql: `SELECT assigned_staff_id, assigned_staff_name FROM conversations WHERE id = ? LIMIT 1`,
        args: [params.conversationId],
      })
      .catch(() => ({ rows: [] as Record<string, unknown>[] }));
    const currentAssignedId =
      convRes.rows[0]?.assigned_staff_id &&
      String(convRes.rows[0].assigned_staff_id) !== "ACRIO"
        ? String(convRes.rows[0].assigned_staff_id)
        : "";

    let targetStaff: {
      id: string;
      name: string;
      email: string;
      whatsappNumber: string;
    } | null = null;

    if (currentAssignedId) {
      const uRes = await auth
        .execute({
          sql: `SELECT id, name, email, whatsapp_number, status FROM users WHERE id = ? LIMIT 1`,
          args: [currentAssignedId],
        })
        .catch(() => ({ rows: [] as Record<string, unknown>[] }));
      const u = uRes.rows[0];
      if (u && String(u.status) === "ACTIVE") {
        targetStaff = {
          id: String(u.id),
          name: String(u.name || convRes.rows[0]?.assigned_staff_name || "Team Member"),
          email: String(u.email || ""),
          whatsappNumber: String(u.whatsapp_number || ""),
        };
      }
    }

    // 2. Otherwise pick ONLY ONE least-loaded available Sales Team responder (never blast the entire team).
    if (!targetStaff) {
      const [members, loadRes, devRes] = await Promise.all([
        conv.execute(
          `SELECT staff_id, staff_name, staff_email, tier
           FROM team_members
           WHERE team_id = 'team_sales' AND is_available = 1
           ORDER BY tier ASC, created_at ASC`
        ),
        conv.execute(
          `SELECT assigned_staff_id, COUNT(*) as open_cnt
           FROM conversations
           WHERE status != 'RESOLVED' AND assigned_staff_id IS NOT NULL AND assigned_staff_id != 'ACRIO'
           GROUP BY assigned_staff_id`
        ),
        auth.execute(`SELECT id FROM users WHERE role = 'DEV'`),
      ]);
      const devIds = new Set(devRes.rows.map((d) => String(d.id)));
      const loadMap = new Map<string, number>();
      for (const lr of loadRes.rows) {
        loadMap.set(String(lr.assigned_staff_id), Number(lr.open_cnt ?? 0));
      }
      const candidates = members.rows
        .filter((m) => !devIds.has(String(m.staff_id)))
        .sort((a, b) => {
          const tA = String(a.tier || "P0");
          const tB = String(b.tier || "P0");
          if (tA !== tB) return tA.localeCompare(tB);
          return (loadMap.get(String(a.staff_id)) ?? 0) - (loadMap.get(String(b.staff_id)) ?? 0);
        });
      const chosen = candidates[0] || members.rows[0];
      if (chosen) {
        const sid = String(chosen.staff_id);
        const uRes = await auth
          .execute({
            sql: `SELECT name, email, whatsapp_number, status FROM users WHERE id = ? LIMIT 1`,
            args: [sid],
          })
          .catch(() => ({ rows: [] as Record<string, unknown>[] }));
        const u = uRes.rows[0];
        if (!u || String(u.status) === "ACTIVE") {
          targetStaff = {
            id: sid,
            name: String(u?.name || chosen.staff_name || "Sales Team"),
            email: String(u?.email || chosen.staff_email || ""),
            whatsappNumber: String(u?.whatsapp_number || ""),
          };
        }
      }
    }

    if (!targetStaff) return;

    const detail = `${params.customerName} (${params.customerPhone}) wants a call in the ${params.slot}.\nInterested in: ${params.topic}.`;
    await createNotification({
      staffId: targetStaff.id,
      type: "CALLBACK",
      conversationId: params.conversationId,
      messageId: params.requestId,
      fromName: "ACRIO",
      customerName: params.customerName,
      text: detail,
    }).catch(() => {});

    if (targetStaff.email) {
      void sendStaffAlertEmail({
        staffId: targetStaff.id,
        staffEmail: targetStaff.email,
        staffName: targetStaff.name,
        subject: `Callback request: ${params.customerName} (${params.customerPhone})`,
        headline: "New callback request",
        detail,
        conversationId: params.conversationId,
        ctaLabel: "Open the chat",
        dispatchType: "STAFF_CALLBACK",
      }).catch(() => {});
    }

    if (targetStaff.whatsappNumber) {
      void sendCallbackRequestAlertTemplate({
        toPhone: targetStaff.whatsappNumber,
        staffId: targetStaff.id,
        staffName: targetStaff.name,
        customerName: params.customerName,
        customerPhone: params.customerPhone,
        preferredTime: params.slot || "As soon as possible",
      }).catch(() => {});
    }
  } catch (err) {
    console.warn("[notify] callback notification failed:", (err as Error)?.message || err);
  }
}

function rowToNotification(r: Record<string, unknown>): StaffNotification {
  return {
    id: String(r.id),
    staffId: String(r.staff_id),
    type: String(r.type) as StaffNotification["type"],
    conversationId: String(r.conversation_id),
    messageId: String(r.message_id || ""),
    fromName: String(r.from_name || ""),
    customerName: String(r.customer_name || ""),
    text: String(r.text || ""),
    isRead: Number(r.is_read) === 1,
    createdAt: String(r.created_at),
  };
}

export async function listStaffNotifications(
  staffId: string,
  limit = 30
): Promise<{ notifications: StaffNotification[]; unreadCount: number }> {
  await ensureStaffNotificationsTable();
  const conv = getRawLibSqlClient("conversations");
  const [list, unread] = await Promise.all([
    conv.execute({
      sql: `SELECT * FROM staff_notifications WHERE staff_id = ? ORDER BY created_at DESC LIMIT ?`,
      args: [staffId, limit],
    }),
    conv.execute({
      sql: `SELECT COUNT(*) AS c FROM staff_notifications WHERE staff_id = ? AND is_read = 0`,
      args: [staffId],
    }),
  ]);
  return {
    notifications: list.rows.map((r) => rowToNotification(r as Record<string, unknown>)),
    unreadCount: Number(unread.rows[0]?.c || 0),
  };
}

export async function markStaffNotificationsRead(staffId: string, ids?: string[]): Promise<void> {
  await ensureStaffNotificationsTable();
  const conv = getRawLibSqlClient("conversations");
  if (ids && ids.length > 0) {
    const marks = ids.map(() => "?").join(",");
    await conv.execute({
      sql: `UPDATE staff_notifications SET is_read = 1 WHERE staff_id = ? AND id IN (${marks})`,
      args: [staffId, ...ids],
    });
  } else {
    await conv.execute({
      sql: `UPDATE staff_notifications SET is_read = 1 WHERE staff_id = ?`,
      args: [staffId],
    });
  }
}
