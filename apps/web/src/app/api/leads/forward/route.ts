import { NextResponse } from "next/server";
import {
  ensureDatabasesBootstrapped,
  getRawLibSqlClient,
  normalizeWhatsAppPhone,
} from "@cc/database";
import { hasPermission } from "@cc/rbac";
import { logConversationAssignment } from "@cc/workers";
import { assignLeadFromOwner, type LeadItem } from "@cc/workers/owner-desk";
import { getCurrentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  if (!hasPermission(user.role, "inbox:view", user.status)) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  await ensureDatabasesBootstrapped();
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const leadId = String(body.leadId || "").trim();
  const targetStaffId = String(body.targetStaffId || "").trim(); // empty = next in A-Z sequence
  const noteText = String(body.note || "").trim();
  const conv = getRawLibSqlClient("conversations");
  const auth = getRawLibSqlClient("core_auth");

  const items: LeadItem[] = [];
  let sourceConvId = String(body.conversationId || "").trim();

  if (leadId.startsWith("fw_")) {
    const rawFwId = leadId.slice(3);
    const fwRes = await conv.execute({
      sql: `SELECT * FROM lead_forwards WHERE id = ? LIMIT 1`,
      args: [rawFwId],
    });
    const fw = fwRes.rows[0];
    if (!fw) {
      return NextResponse.json({ ok: false, error: "Lead not found." }, { status: 404 });
    }
    const custLine = [
      fw.customer_name ? `Customer: ${String(fw.customer_name)}` : "",
      fw.customer_phone ? `Phone: ${String(fw.customer_phone)}` : "",
      String(fw.lead_text || "") !== "(attachments only)" ? String(fw.lead_text || "") : "",
      noteText ? `Note from ${user.name}: ${noteText}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    if (custLine) items.push({ kind: "TEXT", text: custLine, at: Date.now() });
    try {
      const media = JSON.parse(String(fw.media_json || "[]"));
      if (Array.isArray(media)) {
        for (const m of media) {
          if (m && typeof m === "object" && m.kind) items.push(m as LeadItem);
        }
      }
    } catch {
      // ignore malformed media_json
    }
  } else {
    const text = [
      body.customerName ? `Customer: ${String(body.customerName)}` : "",
      body.customerPhone ? `Phone: ${String(body.customerPhone)}` : "",
      body.title ? `Topic: ${String(body.title)}` : "",
      body.body ? String(body.body) : "",
      noteText ? `Note from ${user.name}: ${noteText}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    if (text) items.push({ kind: "TEXT", text, at: Date.now() });
  }

  if (items.length === 0) {
    return NextResponse.json(
      { ok: false, error: "Lead has no details or attachments to forward." },
      { status: 400 }
    );
  }

  const uRow = await auth
    .execute({
      sql: `SELECT whatsapp_number FROM users WHERE id = ? LIMIT 1`,
      args: [user.id],
    })
    .catch(() => ({ rows: [] as Record<string, unknown>[] }));
  const callerPhone =
    normalizeWhatsAppPhone(String(uRow.rows[0]?.whatsapp_number || user.whatsappNumber || "")) ||
    user.whatsappNumber ||
    user.id;

  if (!sourceConvId && body.customerPhone) {
    const normCust = normalizeWhatsAppPhone(String(body.customerPhone));
    if (normCust) {
      const cRes = await conv
        .execute({
          sql: `SELECT id FROM conversations WHERE customer_phone = ? LIMIT 1`,
          args: [normCust],
        })
        .catch(() => ({ rows: [] as Record<string, unknown>[] }));
      if (cRes.rows[0]?.id) sourceConvId = String(cRes.rows[0].id);
    }
  }

  const hubBase = process.env.NEXT_PUBLIC_APP_URL || "https://chat.ccapl.cc";
  const result = await assignLeadFromOwner(
    {
      found: true,
      targetQuery: "",
      generic: !targetStaffId,
      verb: "forward",
      leadText: items.find((i) => i.kind === "TEXT")?.text || "",
    },
    {
      conversationId: sourceConvId || `conv_hub_fwd_${user.id}`,
      ownerPhone: callerPhone,
      ownerName: user.name,
      text: noteText || "Forwarded lead from Hub",
      hubBase,
      logAssignment: logConversationAssignment,
      targetStaffIdOverride: targetStaffId || undefined,
      itemsOverride: items,
      isStaffForwarder: true,
    }
  );

  if (!result.assignedStaffId) {
    return NextResponse.json(
      { ok: false, error: result.reply || "Could not forward lead." },
      { status: 400 }
    );
  }

  return NextResponse.json({
    ok: true,
    assignedStaffId: result.assignedStaffId,
    assignedStaffName: result.assignedStaffName,
    message: `Lead forwarded to ${result.assignedStaffName}.`,
  });
}
