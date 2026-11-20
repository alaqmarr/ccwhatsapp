import { normalizeWhatsAppPhone } from "./contacts-sync";
import { getRawLibSqlClient } from "./handles";
import {
  listActiveNonClientStaff,
  resolveRequestedOrPreferredStaffForInbound,
} from "./staff-routing";
import { pickNextSequentialStaffAtoZ } from "./sequential-assignment";

export type CallQueueAssignmentMode =
  | "AUTO_PERFORMANCE"
  | "AUTO_RANDOM"
  | "PREFERRED_OR_PAST"
  | "OPEN_POOL"
  | "MANUAL";

export interface CallDispatchRecord {
  id: string;
  customerPhone: string;
  customerName: string;
  source: string;
  productTopic: string;
  notes: string;
  recordingUrl: string;
  recordingFileName: string;
  recordingMimeType: string;
  attachmentUrl: string;
  attachmentName: string;
  assignmentMode: CallQueueAssignmentMode;
  assignmentReason: string;
  assignedStaffId: string | null;
  assignedStaffName: string;
  status: "PENDING" | "IN_PROGRESS" | "RESOLVED";
  priority: "URGENT" | "HIGH" | "NORMAL";
  conversationId: string | null;
  resolutionNotes: string;
  submittedById: string | null;
  submittedByName: string;
  pickedUpAt: string | null;
  resolvedAt: string | null;
  resolvedByName: string;
  createdAt: string;
  updatedAt: string;
}

export interface RankedStaffCandidate {
  staffId: string;
  staffName: string;
  role: string;
  resolved30d: number;
  avgFirstResponseSec: number | null;
  openLoad: number;
  performanceScore: number;
}

async function ensureCallDispatchTable(): Promise<void> {
  const conv = getRawLibSqlClient("conversations");
  await conv.execute(`CREATE TABLE IF NOT EXISTS call_dispatch_queue (
    id TEXT PRIMARY KEY,
    customer_phone TEXT NOT NULL DEFAULT '',
    customer_name TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL DEFAULT 'Direct Call',
    product_topic TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    recording_url TEXT DEFAULT '',
    recording_file_name TEXT DEFAULT '',
    recording_mime_type TEXT DEFAULT '',
    attachment_url TEXT DEFAULT '',
    attachment_name TEXT DEFAULT '',
    assignment_mode TEXT NOT NULL DEFAULT 'AUTO_PERFORMANCE',
    assignment_reason TEXT DEFAULT '',
    assigned_staff_id TEXT,
    assigned_staff_name TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'PENDING',
    priority TEXT NOT NULL DEFAULT 'NORMAL',
    conversation_id TEXT,
    resolution_notes TEXT DEFAULT '',
    submitted_by_id TEXT,
    submitted_by_name TEXT NOT NULL DEFAULT 'Desk',
    picked_up_at TEXT,
    resolved_at TEXT,
    resolved_by_name TEXT DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`);
}

export async function computePerformanceRankedStaff(): Promise<RankedStaffCandidate[]> {
  const staffList = (await listActiveNonClientStaff()).filter(
    (s) => s.role !== "DEV" && s.assignmentsEnabled
  );
  if (staffList.length === 0) return [];
  const conv = getRawLibSqlClient("conversations");
  const cutoff30 = new Date(Date.now() - 30 * 86400000).toISOString();

  const [resolvedRes, respRes, loadRes, queueLoadRes] = await Promise.all([
    conv
      .execute({
        sql: `SELECT resolved_by_id, resolved_by_name, COUNT(*) AS cnt
              FROM conversations WHERE status = 'RESOLVED' AND resolved_at >= ?
              GROUP BY resolved_by_id, resolved_by_name`,
        args: [cutoff30],
      })
      .catch(() => ({ rows: [] as any[] })),
    conv
      .execute({
        sql: `SELECT to_staff_id, AVG(first_response_seconds) AS avg_sec
              FROM conversation_assignments
              WHERE assigned_at >= ? AND first_response_seconds IS NOT NULL AND to_staff_id != 'ACRIO'
              GROUP BY to_staff_id`,
        args: [cutoff30],
      })
      .catch(() => ({ rows: [] as any[] })),
    conv
      .execute(
        `SELECT assigned_staff_id, COUNT(*) AS cnt
         FROM conversations
         WHERE status != 'RESOLVED' AND assigned_staff_id IS NOT NULL AND assigned_staff_id != 'ACRIO'
         GROUP BY assigned_staff_id`
      )
      .catch(() => ({ rows: [] as any[] })),
    conv
      .execute(
        `SELECT assigned_staff_id, COUNT(*) AS cnt
         FROM call_dispatch_queue
         WHERE status != 'RESOLVED' AND assigned_staff_id IS NOT NULL
         GROUP BY assigned_staff_id`
      )
      .catch(() => ({ rows: [] as any[] })),
  ]);

  const resolvedMap = new Map<string, number>();
  for (const r of resolvedRes.rows) {
    const sid = r.resolved_by_id ? String(r.resolved_by_id) : "";
    if (sid) resolvedMap.set(sid, (resolvedMap.get(sid) || 0) + Number(r.cnt || 0));
  }
  const avgSecMap = new Map<string, number>();
  for (const r of respRes.rows) {
    const sid = String(r.to_staff_id || "");
    if (sid && r.avg_sec != null) avgSecMap.set(sid, Math.round(Number(r.avg_sec)));
  }
  const openMap = new Map<string, number>();
  for (const r of [...loadRes.rows, ...queueLoadRes.rows]) {
    const sid = String(r.assigned_staff_id || "");
    if (sid) openMap.set(sid, (openMap.get(sid) || 0) + Number(r.cnt || 0));
  }

  return staffList
    .map((s) => {
      const resolved30d = resolvedMap.get(s.id) || 0;
      const avgSec = avgSecMap.has(s.id) ? avgSecMap.get(s.id)! : null;
      const openLoad = openMap.get(s.id) || 0;
      const speedBonus = avgSec === null ? 15 : Math.max(0, 40 - Math.round(avgSec / 45));
      const performanceScore = Math.max(
        1,
        Math.round(50 + resolved30d * 4 + speedBonus - openLoad * 6)
      );
      return {
        staffId: s.id,
        staffName: s.name,
        role: s.role,
        resolved30d,
        avgFirstResponseSec: avgSec,
        openLoad,
        performanceScore,
      };
    })
    .sort((a, b) => b.performanceScore - a.performanceScore || a.openLoad - b.openLoad);
}

function mapCallDispatchRow(r: Record<string, unknown>): CallDispatchRecord {
  const modeRaw = String(r.assignment_mode || "AUTO_PERFORMANCE");
  const mode: CallQueueAssignmentMode = (
    ["AUTO_PERFORMANCE", "AUTO_RANDOM", "PREFERRED_OR_PAST", "OPEN_POOL", "MANUAL"].includes(
      modeRaw
    )
      ? modeRaw
      : "AUTO_PERFORMANCE"
  ) as CallQueueAssignmentMode;

  return {
    id: String(r.id),
    customerPhone: String(r.customer_phone || ""),
    customerName: String(r.customer_name || ""),
    source: String(r.source || "Direct Call"),
    productTopic: String(r.product_topic || ""),
    notes: String(r.notes || ""),
    recordingUrl: String(r.recording_url || ""),
    recordingFileName: String(r.recording_file_name || ""),
    recordingMimeType: String(r.recording_mime_type || ""),
    attachmentUrl: String(r.attachment_url || ""),
    attachmentName: String(r.attachment_name || ""),
    assignmentMode: mode,
    assignmentReason: String(r.assignment_reason || ""),
    assignedStaffId: r.assigned_staff_id ? String(r.assigned_staff_id) : null,
    assignedStaffName: String(r.assigned_staff_name || ""),
    status:
      String(r.status) === "IN_PROGRESS" || String(r.status) === "RESOLVED"
        ? (String(r.status) as "IN_PROGRESS" | "RESOLVED")
        : "PENDING",
    priority:
      String(r.priority) === "URGENT" || String(r.priority) === "HIGH"
        ? (String(r.priority) as "URGENT" | "HIGH")
        : "NORMAL",
    conversationId: r.conversation_id ? String(r.conversation_id) : null,
    resolutionNotes: String(r.resolution_notes || ""),
    submittedById: r.submitted_by_id ? String(r.submitted_by_id) : null,
    submittedByName: String(r.submitted_by_name || "Desk"),
    pickedUpAt: r.picked_up_at ? String(r.picked_up_at) : null,
    resolvedAt: r.resolved_at ? String(r.resolved_at) : null,
    resolvedByName: String(r.resolved_by_name || ""),
    createdAt: String(r.created_at || ""),
    updatedAt: String(r.updated_at || ""),
  };
}

export async function listCallDispatchQueue(limit = 150): Promise<CallDispatchRecord[]> {
  await ensureCallDispatchTable();
  const conv = getRawLibSqlClient("conversations");
  const res = await conv.execute({
    sql: `SELECT id, customer_phone, customer_name, source, product_topic, notes,
                 recording_url, recording_file_name, recording_mime_type,
                 attachment_url, attachment_name, assignment_mode, assignment_reason,
                 assigned_staff_id, assigned_staff_name, status, priority,
                 conversation_id, resolution_notes, submitted_by_id, submitted_by_name,
                 picked_up_at, resolved_at, resolved_by_name, created_at, updated_at
          FROM call_dispatch_queue
          ORDER BY CASE status WHEN 'PENDING' THEN 0 WHEN 'IN_PROGRESS' THEN 1 ELSE 2 END, created_at DESC
          LIMIT ?`,
    args: [limit],
  });
  return res.rows.map((r) => mapCallDispatchRow(r as Record<string, unknown>));
}

export async function createCallDispatchItem(params: {
  customerPhone: string;
  customerName?: string;
  source?: string;
  productTopic?: string;
  notes?: string;
  recordingUrl?: string;
  recordingFileName?: string;
  recordingMimeType?: string;
  attachmentUrl?: string;
  attachmentName?: string;
  assignmentMode?: CallQueueAssignmentMode;
  manualStaffId?: string;
  priority?: "URGENT" | "HIGH" | "NORMAL";
  submittedById: string;
  submittedByName: string;
}): Promise<CallDispatchRecord> {
  await ensureCallDispatchTable();
  const conv = getRawLibSqlClient("conversations");
  const nowIso = new Date().toISOString();
  const normPhone = normalizeWhatsAppPhone(params.customerPhone) || params.customerPhone.trim();
  const mode: CallQueueAssignmentMode = params.assignmentMode || "AUTO_PERFORMANCE";
  const ranked = await computePerformanceRankedStaff();

  let assignedStaffId: string | null = null;
  let assignedStaffName = "";
  let assignmentReason = "";

  const pref =
    normPhone && mode !== "OPEN_POOL" && mode !== "MANUAL"
      ? await resolveRequestedOrPreferredStaffForInbound({
          customerPhone: normPhone,
          inboundText: `${params.productTopic || ""} ${params.notes || ""}`,
        }).catch(() => null)
      : null;

  if (mode === "MANUAL" && params.manualStaffId) {
    const staffList = await listActiveNonClientStaff();
    const hit = staffList.find((s) => s.id === params.manualStaffId);
    if (hit) {
      assignedStaffId = hit.id;
      assignedStaffName = hit.name;
      assignmentReason = `Manually assigned by ${params.submittedByName}`;
    }
  } else if (pref && mode === "PREFERRED_OR_PAST") {
    assignedStaffId = pref.staffId;
    assignedStaffName = pref.staffName;
    assignmentReason = `${pref.reason} (${pref.matchType.replace(/_/g, " ")})`;
  } else if ((mode === "AUTO_PERFORMANCE" || mode === "AUTO_RANDOM") && ranked.length > 0) {
    const seqPick = await pickNextSequentialStaffAtoZ(
      ranked.map((r) => ({ id: r.staffId, name: r.staffName })),
      "call_dispatch_queue"
    );
    if (seqPick) {
      assignedStaffId = seqPick.chosen.id;
      assignedStaffName = seqPick.chosen.name;
      assignmentReason = `Assigned sequentially A-Z (${seqPick.position} of ${seqPick.total})`;
    } else {
      assignmentReason = "Added to open team pickup pool";
    }
  } else {
    assignmentReason = "Added to open team pickup pool";
  }

  const existingConv = normPhone
    ? await conv
        .execute({
          sql: `SELECT id FROM conversations WHERE customer_phone = ? LIMIT 1`,
          args: [normPhone],
        })
        .catch(() => ({ rows: [] as any[] }))
    : { rows: [] as any[] };
  const conversationId = existingConv.rows[0]?.id ? String(existingConv.rows[0].id) : null;

  const id = `cq_${Math.random().toString(36).slice(2, 10)}`;
  await conv.execute({
    sql: `INSERT INTO call_dispatch_queue (
      id, customer_phone, customer_name, source, product_topic, notes,
      recording_url, recording_file_name, recording_mime_type, attachment_url, attachment_name,
      assignment_mode, assignment_reason, assigned_staff_id, assigned_staff_name,
      status, priority, conversation_id, submitted_by_id, submitted_by_name, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?, ?, ?, ?)`,
    args: [
      id,
      normPhone,
      (params.customerName || normPhone || "Caller").trim(),
      (params.source || "Direct Call").trim(),
      (params.productTopic || "").trim(),
      (params.notes || "").trim(),
      (params.recordingUrl || "").trim(),
      (params.recordingFileName || "").trim(),
      (params.recordingMimeType || "").trim(),
      (params.attachmentUrl || "").trim(),
      (params.attachmentName || "").trim(),
      mode,
      assignmentReason,
      assignedStaffId,
      assignedStaffName,
      params.priority || "NORMAL",
      conversationId,
      params.submittedById,
      params.submittedByName,
      nowIso,
      nowIso,
    ],
  });

  const rows = await conv.execute({
    sql: `SELECT * FROM call_dispatch_queue WHERE id = ? LIMIT 1`,
    args: [id],
  });
  return mapCallDispatchRow(rows.rows[0] as Record<string, unknown>);
}

export async function claimCallDispatchItem(params: {
  id: string;
  actorId: string;
  actorName: string;
}): Promise<{
  ok: boolean;
  conflict?: boolean;
  claimedByStaffName?: string;
  item: CallDispatchRecord | null;
  error?: string;
}> {
  await ensureCallDispatchTable();
  const conv = getRawLibSqlClient("conversations");
  const nowIso = new Date().toISOString();

  const existing = await conv.execute({
    sql: `SELECT * FROM call_dispatch_queue WHERE id = ? LIMIT 1`,
    args: [params.id],
  });
  if (!existing.rows[0]) {
    return { ok: false, item: null, error: "Queue item not found." };
  }

  const updateRes = await conv.execute({
    sql: `UPDATE call_dispatch_queue
          SET assigned_staff_id = ?,
              assigned_staff_name = ?,
              status = 'IN_PROGRESS',
              picked_up_at = COALESCE(picked_up_at, ?),
              updated_at = ?
          WHERE id = ?
            AND (
              assigned_staff_id IS NULL
              OR TRIM(assigned_staff_id) = ''
              OR assigned_staff_id = ?
            )`,
    args: [params.actorId, params.actorName, nowIso, nowIso, params.id, params.actorId],
  });

  const latest = await conv.execute({
    sql: `SELECT * FROM call_dispatch_queue WHERE id = ? LIMIT 1`,
    args: [params.id],
  });
  const mapped = latest.rows[0]
    ? mapCallDispatchRow(latest.rows[0] as Record<string, unknown>)
    : null;

  if (Number(updateRes.rowsAffected ?? 0) === 0 && mapped) {
    const ownerName = mapped.assignedStaffName || "another team member";
    return {
      ok: false,
      conflict: true,
      claimedByStaffName: ownerName,
      item: mapped,
      error: `Already accepted by ${ownerName} (first-come, first-serve).`,
    };
  }

  return { ok: true, item: mapped };
}

export async function updateCallDispatchItem(params: {
  id: string;
  action: "pick_up" | "reassign" | "resolve" | "reopen" | "link_conversation";
  actorId: string;
  actorName: string;
  targetStaffId?: string;
  targetStaffName?: string;
  resolutionNotes?: string;
  conversationId?: string;
}): Promise<CallDispatchRecord | null> {
  await ensureCallDispatchTable();
  const conv = getRawLibSqlClient("conversations");
  const existing = await conv.execute({
    sql: `SELECT * FROM call_dispatch_queue WHERE id = ? LIMIT 1`,
    args: [params.id],
  });
  if (!existing.rows[0]) return null;

  const nowIso = new Date().toISOString();

  if (params.action === "pick_up") {
    await conv.execute({
      sql: `UPDATE call_dispatch_queue
            SET assigned_staff_id = ?,
                assigned_staff_name = ?,
                status = 'IN_PROGRESS',
                picked_up_at = COALESCE(picked_up_at, ?),
                updated_at = ?
            WHERE id = ?`,
      args: [params.actorId, params.actorName, nowIso, nowIso, params.id],
    });
  } else if (params.action === "reassign" && params.targetStaffId) {
    await conv.execute({
      sql: `UPDATE call_dispatch_queue
            SET assigned_staff_id = ?,
                assigned_staff_name = ?,
                assignment_reason = ?,
                status = CASE WHEN status = 'RESOLVED' THEN 'PENDING' ELSE status END,
                updated_at = ?
            WHERE id = ?`,
      args: [
        params.targetStaffId,
        params.targetStaffName || params.targetStaffId,
        `Reassigned by ${params.actorName}`,
        nowIso,
        params.id,
      ],
    });
  } else if (params.action === "resolve") {
    await conv.execute({
      sql: `UPDATE call_dispatch_queue
            SET status = 'RESOLVED',
                resolution_notes = ?,
                resolved_by_name = ?,
                resolved_at = ?,
                updated_at = ?
            WHERE id = ?`,
      args: [
        (params.resolutionNotes || "Handled and resolved.").trim(),
        params.actorName,
        nowIso,
        nowIso,
        params.id,
      ],
    });
  } else if (params.action === "reopen") {
    await conv.execute({
      sql: `UPDATE call_dispatch_queue
            SET status = 'PENDING',
                resolved_at = NULL,
                updated_at = ?
            WHERE id = ?`,
      args: [nowIso, params.id],
    });
  } else if (params.action === "link_conversation" && params.conversationId) {
    await conv.execute({
      sql: `UPDATE call_dispatch_queue
            SET conversation_id = ?,
                status = CASE WHEN status = 'PENDING' THEN 'IN_PROGRESS' ELSE status END,
                picked_up_at = COALESCE(picked_up_at, ?),
                updated_at = ?
            WHERE id = ?`,
      args: [params.conversationId, nowIso, nowIso, params.id],
    });
  }

  const next = await conv.execute({
    sql: `SELECT * FROM call_dispatch_queue WHERE id = ? LIMIT 1`,
    args: [params.id],
  });
  return next.rows[0] ? mapCallDispatchRow(next.rows[0] as Record<string, unknown>) : null;
}
