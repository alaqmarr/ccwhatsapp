import { NextResponse } from "next/server";
import { loadEnquiriesPayload } from "@/lib/loaders/operations";
import { getCurrentUser } from "@/lib/session";
import { handleEnquirySendReply } from "@/lib/api/enquiries/send-reply";
import { evaluateWebsiteEnquiryWithAi } from "@cc/connections";
import {
  ensureDatabasesBootstrapped,
  ensureEcosystemEnquiriesTable,
  getRawLibSqlClient,
} from "@cc/database";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const user = await getCurrentUser().catch(() => null);
  if (!user || user.status !== "ACTIVE" || user.role === "CLIENT") {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const payload = await loadEnquiriesPayload({
    brand: (searchParams.get("brand") || "ALL") as
      | "ALL"
      | "CLASSIC_CONCEPTS"
      | "CLASSIC_EDGE_53",
    status: (searchParams.get("status") || "ALL") as "ALL" | "New" | "Replied",
    search: (searchParams.get("search") || "").trim(),
    limit: Math.min(500, Math.max(1, Number(searchParams.get("limit") || 250))),
  });

  return NextResponse.json(payload);
}

export async function POST(req: Request) {
  const user = await getCurrentUser().catch(() => null);
  if (!user || user.status !== "ACTIVE" || user.role === "CLIENT") {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  await ensureDatabasesBootstrapped();
  await ensureEcosystemEnquiriesTable();

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const action = String(body.action || "send_reply");

  if (action === "draft_ai_reply") {
    const brand: "CLASSIC_CONCEPTS" | "CLASSIC_EDGE_53" =
      body.brand === "CLASSIC_EDGE_53" ? "CLASSIC_EDGE_53" : "CLASSIC_CONCEPTS";
    const customerName = String(body.customerName || "Customer").trim();
    const customerEmail = String(body.customerEmail || "").trim();
    const customerPhone = String(body.customerPhone || "").trim();
    const productName = String(body.productName || "").trim();
    const message = String(body.message || "").trim();
    const customTone = String(body.customTone || "").trim();

    const evalRes = await evaluateWebsiteEnquiryWithAi({
      brand,
      customerName,
      customerEmail,
      customerPhone,
      productName,
      message: customTone ? `${message}\n\n[Staff Note / Tone: ${customTone}]` : message,
    });

    if (body.id) {
      const crm = getRawLibSqlClient("crm_orders");
      await crm
        .execute({
          sql: `UPDATE ecosystem_enquiries SET ai_suggested_reply = ?, updated_at = ? WHERE id = ?`,
          args: [evalRes.smartReplyText, new Date().toISOString(), String(body.id)],
        })
        .catch(() => {});
    }

    return NextResponse.json({
      ok: true,
      draftEmailReply: evalRes.smartReplyText,
      draftWhatsAppReply: evalRes.whatsappSummaryText,
      smartCategory: evalRes.smartCategory,
      matchedItems: evalRes.matchedItems,
    });
  }

  if (action === "send_reply") {
    return handleEnquirySendReply(user, body);
  }

  return NextResponse.json(
    { ok: false, error: "Unsupported action" },
    { status: 400 }
  );
}
