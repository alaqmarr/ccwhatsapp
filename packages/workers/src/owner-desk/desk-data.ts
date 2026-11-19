import {
  ensureDatabasesBootstrapped,
  getRawLibSqlClient,
  normalizeWhatsAppPhone,
} from "@cc/database";
import { suffix10, type DeskStaff, type WindowState } from "./types";

export async function loadDeskStaff(): Promise<DeskStaff[]> {
  const auth = getRawLibSqlClient("core_auth");
  const res = await auth.execute(
    `SELECT id, name, email, role, department, whatsapp_number
     FROM users WHERE status = 'ACTIVE' AND role != 'CLIENT' ORDER BY name ASC`
  );
  return res.rows.map((r) => {
    const phone = normalizeWhatsAppPhone(String(r.whatsapp_number || "")) || "";
    return {
      id: String(r.id),
      name: String(r.name || "").trim(),
      email: String(r.email || "").trim(),
      role: String(r.role || "STAFF"),
      department: String(r.department || "Sales & Support"),
      phone,
      suffix: suffix10(phone),
    };
  });
}

export async function loadWindowStates(staff: DeskStaff[]): Promise<Map<string, WindowState>> {
  const out = new Map<string, WindowState>();
  const phones = staff.map((s) => s.phone).filter(Boolean);
  if (phones.length === 0) return out;
  const conv = getRawLibSqlClient("conversations");
  const res = await conv.execute({
    sql: `SELECT id, customer_phone, window_expires_at FROM conversations
          WHERE customer_phone IN (${phones.map(() => "?").join(",")})`,
    args: phones,
  });
  const now = Date.now();
  for (const r of res.rows) {
    const exp = r.window_expires_at ? new Date(String(r.window_expires_at)).getTime() : 0;
    out.set(suffix10(String(r.customer_phone)), {
      open: exp > now,
      until: exp > now ? new Date(exp).toISOString() : null,
      conversationId: String(r.id),
    });
  }
  return out;
}

export function windowFor(map: Map<string, WindowState>, s: DeskStaff): WindowState {
  return map.get(s.suffix) || { open: false, until: null, conversationId: null };
}

let leadTableReady: Promise<void> | null = null;
export function ensureLeadForwardsTable(): Promise<void> {
  if (!leadTableReady) {
    leadTableReady = (async () => {
      await ensureDatabasesBootstrapped();
      const conv = getRawLibSqlClient("conversations");
      await conv.execute(`CREATE TABLE IF NOT EXISTS lead_forwards (
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
      )`);
      // Older copies of the table (created before attachments were supported) get the new column.
      await conv.execute(`ALTER TABLE lead_forwards ADD COLUMN media_json TEXT NOT NULL DEFAULT '[]'`).catch(() => {});
      await conv.execute(
        `CREATE INDEX IF NOT EXISTS idx_lead_fw_staff ON lead_forwards (staff_id, delivery_status, created_at DESC)`
      );
      await conv.execute(
        `CREATE INDEX IF NOT EXISTS idx_lead_fw_owner ON lead_forwards (owner_phone, created_at DESC)`
      );
    })().catch((err) => {
      leadTableReady = null;
      throw err;
    });
  }
  return leadTableReady;
}

/** Test helper: lets a test remove its own rows without touching other data. */
export async function deleteLeadForwardsForTest(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await ensureLeadForwardsTable();
  await getRawLibSqlClient("conversations").execute({
    sql: `DELETE FROM lead_forwards WHERE id IN (${ids.map(() => "?").join(",")})`,
    args: ids,
  });
}
