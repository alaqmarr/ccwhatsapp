import { getVerifiedLiveBrandAndTeamInfo } from "./brand-team-info";
import { normalizeWhatsAppPhone } from "./contacts-sync";
import { getRawLibSqlClient } from "./handles";

export interface ConversationCollaborator {
  staffId: string;
  staffName: string;
  addedBy?: string;
  addedAt?: string;
}

export function parseConversationCollaborators(raw: unknown): ConversationCollaborator[] {
  if (!raw) return [];
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    const out: ConversationCollaborator[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const sid = String((item as any).staffId || "").trim();
      const sname = String((item as any).staffName || "").trim();
      if (!sid || sid === "ACRIO" || seen.has(sid)) continue;
      seen.add(sid);
      out.push({
        staffId: sid,
        staffName: sname || sid,
        addedBy: (item as any).addedBy ? String((item as any).addedBy) : undefined,
        addedAt: (item as any).addedAt ? String((item as any).addedAt) : undefined,
      });
    }
    return out;
  } catch {
    return [];
  }
}

export async function addConversationCollaborators(params: {
  conversationId: string;
  members: { staffId: string; staffName: string }[];
  addedBy?: string;
}): Promise<ConversationCollaborator[]> {
  const conv = getRawLibSqlClient("conversations");
  await conv
    .execute(`ALTER TABLE conversations ADD COLUMN collaborators_json TEXT NOT NULL DEFAULT '[]'`)
    .catch(() => {});
  const res = await conv.execute({
    sql: `SELECT assigned_staff_id, collaborators_json FROM conversations WHERE id = ? LIMIT 1`,
    args: [params.conversationId],
  });
  const row = res.rows[0] as Record<string, unknown> | undefined;
  if (!row) return [];
  const ownerId = row.assigned_staff_id ? String(row.assigned_staff_id) : "";
  const existing = parseConversationCollaborators(row.collaborators_json);
  const byId = new Map(existing.map((c) => [c.staffId, c]));
  const nowIso = new Date().toISOString();
  let changed = false;

  for (const m of params.members) {
    const sid = String(m.staffId || "").trim();
    if (!sid || sid === "ACRIO" || sid === ownerId || byId.has(sid)) continue;
    byId.set(sid, {
      staffId: sid,
      staffName: String(m.staffName || sid).trim(),
      addedBy: params.addedBy || "Team Mention",
      addedAt: nowIso,
    });
    changed = true;
  }

  const next = Array.from(byId.values());
  if (changed) {
    await conv.execute({
      sql: `UPDATE conversations SET collaborators_json = ? WHERE id = ?`,
      args: [JSON.stringify(next), params.conversationId],
    });
  }
  return next;
}

export async function removeConversationCollaborator(
  conversationId: string,
  staffId: string
): Promise<ConversationCollaborator[]> {
  const conv = getRawLibSqlClient("conversations");
  const res = await conv.execute({
    sql: `SELECT collaborators_json FROM conversations WHERE id = ? LIMIT 1`,
    args: [conversationId],
  });
  const row = res.rows[0] as Record<string, unknown> | undefined;
  if (!row) return [];
  const existing = parseConversationCollaborators(row.collaborators_json);
  const next = existing.filter((c) => c.staffId !== staffId);
  await conv.execute({
    sql: `UPDATE conversations SET collaborators_json = ? WHERE id = ?`,
    args: [JSON.stringify(next), conversationId],
  });
  return next;
}

export interface ActiveStaffRecord {
  id: string;
  name: string;
  email: string;
  role: string;
  department: string;
  assignmentsEnabled: boolean;
}

export async function listActiveNonClientStaff(): Promise<ActiveStaffRecord[]> {
  const auth = getRawLibSqlClient("core_auth");
  const res = await auth.execute(
    `SELECT id, name, email, role, department, COALESCE(assignments_enabled, 1) AS assignments_enabled
     FROM users
     WHERE status = 'ACTIVE' AND role != 'CLIENT'
     ORDER BY name ASC`
  );
  return res.rows.map((r) => ({
    id: String(r.id),
    name: String(r.name || "").trim(),
    email: String(r.email || "").trim(),
    role: String(r.role || "STAFF"),
    department: String(r.department || "Sales & Support"),
    assignmentsEnabled: Number(r.assignments_enabled ?? 1) !== 0,
  }));
}

export async function listAssignableNonClientStaff(): Promise<ActiveStaffRecord[]> {
  const all = await listActiveNonClientStaff();
  return all.filter((s) => s.assignmentsEnabled);
}

export async function isUserAssignmentsEnabled(staffId: string): Promise<boolean> {
  if (!staffId || staffId === "ACRIO") return true;
  const auth = getRawLibSqlClient("core_auth");
  const res = await auth
    .execute({
      sql: `SELECT status, role, COALESCE(assignments_enabled, 1) AS assignments_enabled
            FROM users WHERE id = ? LIMIT 1`,
      args: [staffId],
    })
    .catch(() => ({ rows: [] as Record<string, unknown>[] }));
  const row = res.rows[0];
  if (!row) return false;
  return (
    String(row.status) === "ACTIVE" &&
    String(row.role) !== "CLIENT" &&
    Number(row.assignments_enabled ?? 1) !== 0
  );
}

export function resolveStaffMemberByQuery(
  query: string,
  staffList: ActiveStaffRecord[]
): ActiveStaffRecord | null {
  const clean = String(query || "")
    .trim()
    .toLowerCase()
    .replace(/^@+/, "");
  if (!clean || clean.length < 2) return null;

  const exact = staffList.find(
    (s) =>
      s.id.toLowerCase() === clean ||
      s.email.toLowerCase() === clean ||
      s.name.toLowerCase() === clean
  );
  if (exact) return exact;

  const byEmailLocal = staffList.find(
    (s) => s.email.split("@")[0]?.toLowerCase() === clean
  );
  if (byEmailLocal) return byEmailLocal;

  const firstCounts = new Map<string, number>();
  for (const s of staffList) {
    const first = s.name.toLowerCase().split(/\s+/)[0] || "";
    if (first.length >= 3) firstCounts.set(first, (firstCounts.get(first) || 0) + 1);
  }
  const firstMatch = staffList.find((s) => {
    const first = s.name.toLowerCase().split(/\s+/)[0] || "";
    return first === clean && (firstCounts.get(first) || 0) === 1;
  });
  if (firstMatch) return firstMatch;

  const subMatches = staffList.filter((s) => {
    const tokens = s.name.toLowerCase().split(/\s+/);
    return tokens.some((t) => t.length >= 3 && (t === clean || (clean.length >= 4 && t.includes(clean))));
  });
  if (subMatches.length === 1) return subMatches[0];

  return null;
}

const REQUESTED_PERSON_RE =
  /\b(?:talk\s+to|speak\s+(?:to|with)|connect(?:\s+me)?\s+(?:to|with)|ask|assign(?:\s+to)?|transfer(?:\s+to)?|call\s+from|message\s+from|looking\s+for|is\s+|from|with)\s+([A-Za-z][A-Za-z.\s]{1,30})/i;

export function detectRequestedStaffInInboundMessage(
  inboundText: string,
  staffList: ActiveStaffRecord[]
): ActiveStaffRecord | null {
  const text = String(inboundText || "").trim();
  if (!text) return null;
  const lower = text.toLowerCase();

  const hasPersonIntent =
    /\b(talk\s*to|speak\s*(?:to|with)|connect|transfer|assign|prefer|handler|mam|ma'am|sir|ji|bhai|please\s*forward|ask\s*for|regarding\s*call|spoke\s*(?:to|with)|talked\s*(?:to|with)|chatting\s*with|dealing\s*with|available|there)\b/i.test(
      lower
    ) || text.split(/\s+/).length <= 5;

  if (!hasPersonIntent) return null;

  const esc = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const sortedByLen = [...staffList].sort((a, b) => b.name.length - a.name.length);

  for (const s of sortedByLen) {
    if (s.name.length >= 4 && new RegExp(`\\b${esc(s.name)}\\b`, "i").test(lower)) {
      return s;
    }
  }

  const reqMatch = text.match(REQUESTED_PERSON_RE);
  const candidatePhrase = reqMatch?.[1] || text;

  const tokenCounts = new Map<string, number>();
  for (const s of staffList) {
    for (const part of s.name.toLowerCase().split(/\s+/)) {
      if (part.length >= 4 && !/^(kumar|singh|sharma|gupta|patel|khan|classic|concepts)$/i.test(part)) {
        tokenCounts.set(part, (tokenCounts.get(part) || 0) + 1);
      }
    }
  }

  for (const s of sortedByLen) {
    if (s.role === "DEV") continue;
    for (const part of s.name.toLowerCase().split(/\s+/)) {
      if (part.length < 4) continue;
      if ((tokenCounts.get(part) || 0) !== 1) continue;
      if (new RegExp(`\\b${esc(part)}\\b`, "i").test(candidatePhrase.toLowerCase())) {
        return s;
      }
    }
  }

  return null;
}

export async function resolveRequestedOrPreferredStaffForInbound(params: {
  customerPhone: string;
  inboundText?: string;
  conversationId?: string;
}): Promise<{
  staffId: string;
  staffName: string;
  matchType: "REQUESTED_BY_CUSTOMER" | "PREFERRED_STAFF" | "PAST_HANDLER";
  reason: string;
} | null> {
  const staffList = (await listActiveNonClientStaff()).filter(
    (s) => s.assignmentsEnabled
  );
  if (staffList.length === 0) return null;
  const activeById = new Map(staffList.map((s) => [s.id, s]));

  if (params.inboundText) {
    const requested = detectRequestedStaffInInboundMessage(params.inboundText, staffList);
    if (requested) {
      return {
        staffId: requested.id,
        staffName: requested.name,
        matchType: "REQUESTED_BY_CUSTOMER",
        reason: `Customer specifically asked for ${requested.name}`,
      };
    }
  }

  const contacts = getRawLibSqlClient("contacts");
  const crm = getRawLibSqlClient("crm_orders");
  const conv = getRawLibSqlClient("conversations");

  const [cntRes, crmRes] = await Promise.all([
    contacts
      .execute({
        sql: `SELECT preferred_staff_id, preferred_staff_name, assigned_owner_id, assigned_owner_name
              FROM contacts WHERE phone = ? LIMIT 1`,
        args: [params.customerPhone],
      })
      .catch(() => ({ rows: [] as any[] })),
    crm
      .execute({
        sql: `SELECT preferred_staff_id, preferred_staff_name FROM customers WHERE phone = ? LIMIT 1`,
        args: [params.customerPhone],
      })
      .catch(() => ({ rows: [] as any[] })),
  ]);

  const cntRow = cntRes.rows[0] as Record<string, unknown> | undefined;
  const crmRow = crmRes.rows[0] as Record<string, unknown> | undefined;

  const prefId = String(
    crmRow?.preferred_staff_id || cntRow?.preferred_staff_id || cntRow?.assigned_owner_id || ""
  ).trim();
  const prefName = String(
    crmRow?.preferred_staff_name || cntRow?.preferred_staff_name || cntRow?.assigned_owner_name || ""
  ).trim();

  if (prefId && prefId !== "ACRIO" && activeById.has(prefId)) {
    const st = activeById.get(prefId)!;
    return {
      staffId: st.id,
      staffName: st.name,
      matchType: "PREFERRED_STAFF",
      reason: `Customer has preferred staff member set (${st.name})`,
    };
  }
  if (prefName && prefName !== "ACRIO" && !/system/i.test(prefName)) {
    const resolvedByName = resolveStaffMemberByQuery(prefName, staffList);
    if (resolvedByName) {
      return {
        staffId: resolvedByName.id,
        staffName: resolvedByName.name,
        matchType: "PREFERRED_STAFF",
        reason: `Customer has preferred staff member (${resolvedByName.name})`,
      };
    }
  }

  const [pastConvRes, pastAssignRes, pastRelRes] = await Promise.all([
    conv
      .execute({
        sql: `SELECT assigned_staff_id, assigned_staff_name, resolved_by_id, resolved_by_name
              FROM conversations
              WHERE customer_phone = ?
                AND (
                  (resolved_by_id IS NOT NULL AND resolved_by_id != '' AND resolved_by_id != 'ACRIO')
                  OR (assigned_staff_id IS NOT NULL AND assigned_staff_id != '' AND assigned_staff_id != 'ACRIO')
                )
              ORDER BY last_message_at DESC LIMIT 3`,
        args: [params.customerPhone],
      })
      .catch(() => ({ rows: [] as any[] })),
    conv
      .execute({
        sql: `SELECT to_staff_id, to_staff_name
              FROM conversation_assignments
              WHERE customer_phone = ?
                AND to_staff_id IS NOT NULL
                AND to_staff_id != ''
                AND to_staff_id != 'ACRIO'
              ORDER BY assigned_at DESC LIMIT 6`,
        args: [params.customerPhone],
      })
      .catch(() => ({ rows: [] as any[] })),
    crm
      .execute({
        sql: `SELECT handled_by FROM customer_relations WHERE customer_phone = ? ORDER BY occurred_at DESC LIMIT 3`,
        args: [params.customerPhone],
      })
      .catch(() => ({ rows: [] as any[] })),
  ]);

  const tryPick = (id?: string | null, name?: string | null) => {
    const cleanId = String(id || "").trim();
    if (cleanId && cleanId !== "ACRIO" && activeById.has(cleanId)) {
      const st = activeById.get(cleanId)!;
      if (st.role !== "DEV") return st;
    }
    const cleanName = String(name || "").trim();
    if (cleanName && cleanName !== "ACRIO") {
      const st = resolveStaffMemberByQuery(cleanName, staffList);
      if (st && st.role !== "DEV") return st;
    }
    return null;
  };

  for (const r of pastConvRes.rows) {
    const hit =
      tryPick(r.resolved_by_id ? String(r.resolved_by_id) : null, r.resolved_by_name ? String(r.resolved_by_name) : null) ||
      tryPick(r.assigned_staff_id ? String(r.assigned_staff_id) : null, r.assigned_staff_name ? String(r.assigned_staff_name) : null);
    if (hit) {
      return {
        staffId: hit.id,
        staffName: hit.name,
        matchType: "PAST_HANDLER",
        reason: `${hit.name} previously handled this customer`,
      };
    }
  }

  for (const r of pastAssignRes.rows) {
    const hit = tryPick(
      r.to_staff_id ? String(r.to_staff_id) : null,
      r.to_staff_name ? String(r.to_staff_name) : null
    );
    if (hit) {
      return {
        staffId: hit.id,
        staffName: hit.name,
        matchType: "PAST_HANDLER",
        reason: `${hit.name} previously handled this customer`,
      };
    }
  }

  for (const r of pastRelRes.rows) {
    const hit = tryPick(null, r.handled_by ? String(r.handled_by) : null);
    if (hit) {
      return {
        staffId: hit.id,
        staffName: hit.name,
        matchType: "PAST_HANDLER",
        reason: `${hit.name} previously handled this customer`,
      };
    }
  }

  return null;
}

export interface InternalStaffCallerProfile {
  isInternalStaff: true;
  hubUserId: string | null;
  name: string;
  firstName: string;
  role: string;
  position: string;
  department: string;
  phone: string;
  email: string | null;
  matchedFrom: "HUB_USER" | "CC_OFFICIAL_TEAM" | "BOTH";
}

function phoneDigitsSuffix(raw: string | null | undefined): string {
  const digits = String(raw || "").replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : digits;
}

/**
 * Identifies whether an inbound WhatsApp phone number belongs to an internal staff member
 * by matching BOTH `core_auth.users.whatsapp_number` (active non-client hub staff) AND
 * the official team roster published on `classicconcepts.in/api/brand-info`.
 */
export async function resolveInternalStaffCallerByPhone(
  rawPhone: string
): Promise<InternalStaffCallerProfile | null> {
  const callerSuffix = phoneDigitsSuffix(rawPhone);
  if (callerSuffix.length < 10) return null;

  const auth = getRawLibSqlClient("core_auth");

  const [hubUsersRes, brandInfo] = await Promise.all([
    auth
      .execute(
        `SELECT id, name, email, whatsapp_number, role, department, status
         FROM users
         WHERE status = 'ACTIVE' AND role != 'CLIENT'`
      )
      .catch(() => ({ rows: [] as Record<string, unknown>[] })),
    getVerifiedLiveBrandAndTeamInfo().catch(() => null),
  ]);

  const hubUsers = hubUsersRes.rows;
  const hubMatch = hubUsers.find(
    (u) => phoneDigitsSuffix(String(u.whatsapp_number || "")) === callerSuffix
  );

  const ccMemberMatch = (brandInfo?.teamMembers || []).find(
    (m) =>
      phoneDigitsSuffix(m.phone) === callerSuffix ||
      phoneDigitsSuffix(m.whatsapp) === callerSuffix
  );

  if (!hubMatch && !ccMemberMatch) return null;

  let linkedHub = hubMatch;
  if (!linkedHub && ccMemberMatch) {
    const cleanTargetName = ccMemberMatch.name.toLowerCase().replace(/[^a-z0-9]/g, "");
    linkedHub = hubUsers.find((u) => {
      const uName = String(u.name || "").toLowerCase().replace(/[^a-z0-9]/g, "");
      const uEmail = String(u.email || "").toLowerCase();
      return (
        (cleanTargetName.length >= 4 &&
          (uName.includes(cleanTargetName) || cleanTargetName.includes(uName))) ||
        (ccMemberMatch.email && uEmail === ccMemberMatch.email.toLowerCase())
      );
    });
  }

  const displayName =
    ccMemberMatch?.name || String(linkedHub?.name || "Team Member").trim();
  const firstName = displayName.split(/\s+/)[0] || displayName;

  return {
    isInternalStaff: true,
    hubUserId: linkedHub?.id ? String(linkedHub.id) : null,
    name: displayName,
    firstName,
    role: linkedHub?.role ? String(linkedHub.role) : "STAFF",
    position:
      ccMemberMatch?.position ||
      String(linkedHub?.department || linkedHub?.role || "Team Member"),
    department: String(
      linkedHub?.department || ccMemberMatch?.position || "Sales & Support"
    ),
    phone: normalizeWhatsAppPhone(rawPhone) || rawPhone,
    email:
      ccMemberMatch?.email ||
      (linkedHub?.email ? String(linkedHub.email) : null),
    matchedFrom:
      hubMatch && ccMemberMatch
        ? "BOTH"
        : hubMatch
        ? "HUB_USER"
        : "CC_OFFICIAL_TEAM",
  };
}
