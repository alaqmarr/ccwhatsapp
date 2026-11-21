import { NextResponse } from "next/server";
import { ensureDatabasesBootstrapped, getRawLibSqlClient } from "@cc/database";
import { hasPermission } from "@cc/rbac";
import { getCurrentUser } from "@/lib/session";
import { handleGetConversationDetail } from "@/lib/api/conversation-detail/get-detail";
import { handleSendMessage } from "@/lib/api/conversation-detail/send-message";
import {
  handleAddInternalNote,
  handleAttachCompanyDocToAcrioNote,
  handleConfirmAcrioNoteAction,
  handleGenerateSummary,
  handleSendNoteInChat,
  handleSimulateCustomerRead,
} from "@/lib/api/conversation-detail/notes-and-acrio";
import {
  handleAddCollaborator,
  handleClaimOrTakeOver,
  handleRemoveCollaborator,
} from "@/lib/api/conversation-detail/takeover-and-collaborators";
import {
  handleAssignStaff,
  handleReopen,
  handleReturnToAcrio,
  handleSmartAssign,
  handleSmartResolve,
} from "@/lib/api/conversation-detail/assignments-and-resolve";
import {
  handleAddOrder,
  handleUpdateCustomerProfile,
} from "@/lib/api/conversation-detail/customer-crm";
import { handleOrderTrackingAction } from "@/lib/api/conversation-detail/order-tracking";
import { handlePolishOutboundMessage } from "@/lib/api/conversation-detail/polish-message";
import type { ConversationActionContext } from "@/lib/api/conversation-detail/shared";

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user || !hasPermission(user.role, "inbox:view", user.status)) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  await ensureDatabasesBootstrapped();
  const { id } = await context.params;
  return handleGetConversationDetail(req, id);
}

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user || !hasPermission(user.role, "inbox:reply", user.status)) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  await ensureDatabasesBootstrapped();
  const { id } = await context.params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const action = String(body.action || "send_message");

  const conv = getRawLibSqlClient("conversations");
  const crm = getRawLibSqlClient("crm_orders");
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();

  const cRes = await conv.execute({
    sql: `SELECT * FROM conversations WHERE id = ? LIMIT 1`,
    args: [id],
  });
  if (!cRes.rows[0]) {
    return NextResponse.json(
      { ok: false, error: "Conversation not found." },
      { status: 404 }
    );
  }
  const cRow = cRes.rows[0] as Record<string, unknown>;

  const ctx: ConversationActionContext = {
    id,
    user,
    body,
    conv,
    crm,
    cRow,
    customerPhone: String(cRow.customer_phone),
    nowMs,
    nowIso,
  };

  switch (action) {
    case "polish_message":
      return handlePolishOutboundMessage(ctx);
    case "send_message":
      return handleSendMessage(ctx);
    case "simulate_customer_read":
      return handleSimulateCustomerRead(id);
    case "add_internal_note":
      return handleAddInternalNote(ctx);
    case "send_note_in_chat":
      return handleSendNoteInChat(ctx);
    case "confirm_acrio_note_action":
      return handleConfirmAcrioNoteAction(ctx);
    case "attach_company_doc_to_acrio_note":
      return handleAttachCompanyDocToAcrioNote(ctx);
    case "claim_assignment":
    case "take_over_from_acrio":
    case "take_over_chat":
      return handleClaimOrTakeOver(ctx, action);
    case "add_collaborator":
      return handleAddCollaborator(ctx);
    case "remove_collaborator":
      return handleRemoveCollaborator(ctx);
    case "generate_summary":
      return handleGenerateSummary(ctx);
    case "return_to_acrio":
      return handleReturnToAcrio(ctx);
    case "smart_assign":
      return handleSmartAssign(ctx);
    case "assign_staff":
      return body.staffId === "ACRIO"
        ? handleReturnToAcrio(ctx)
        : handleAssignStaff(ctx);
    case "smart_resolve":
      return handleSmartResolve(ctx);
    case "reopen":
      return handleReopen(ctx);
    case "update_customer_profile":
      return handleUpdateCustomerProfile(ctx);
    case "add_order":
      return handleAddOrder(ctx);
    case "save_order_tracking":
    case "send_order_tracking":
      return handleOrderTrackingAction(ctx, action);
    default:
      return NextResponse.json(
        { ok: false, error: "Unsupported action" },
        { status: 400 }
      );
  }
}
