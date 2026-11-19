import { NextResponse } from "next/server";
import { ensureDatabasesBootstrapped } from "@cc/database";
import { hasPermission } from "@cc/rbac";
import { loadTemplatesPayload } from "@/lib/loaders/crm";
import { getCurrentUser } from "@/lib/session";
import { handleSaveOrSubmitTemplate } from "@/lib/api/templates/save-and-submit";
import {
  handleAiDraftTemplate,
  handleDeleteTemplate,
  handleDuplicateTemplate,
  handleSaveButtonFlows,
  handleSyncMeta,
  handleTogglePause,
} from "@/lib/api/templates/actions";
import { handleSendTestTemplate } from "@/lib/api/templates/test-send";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user || !hasPermission(user.role, "inbox:view", user.status)) {
    return NextResponse.json(
      { ok: false, error: "Sign in required." },
      { status: 403 }
    );
  }

  const payload = await loadTemplatesPayload(user);
  return NextResponse.json(payload);
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user || !hasPermission(user.role, "templates:manage", user.status)) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Only Manager, Admin, Superadmin, or Dev accounts can create or edit WhatsApp templates.",
      },
      { status: 403 }
    );
  }

  await ensureDatabasesBootstrapped();
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const action = String(body.action || "");
  const nowIso = new Date().toISOString();

  switch (action) {
    case "sync_meta":
      return handleSyncMeta();
    case "ai_draft_template":
      return handleAiDraftTemplate(body);
    case "save_button_flows":
      return handleSaveButtonFlows(body, nowIso);
    case "save_draft":
    case "submit_to_meta":
      return handleSaveOrSubmitTemplate(user, body, action, nowIso);
    case "duplicate_template":
      return handleDuplicateTemplate(user, body, nowIso);
    case "toggle_pause":
      return handleTogglePause(body, nowIso);
    case "delete_template":
      return handleDeleteTemplate(body);
    case "send_test_template":
      return handleSendTestTemplate(user, body);
    default:
      return NextResponse.json(
        { ok: false, error: "Unsupported template action." },
        { status: 400 }
      );
  }
}
