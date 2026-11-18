import { NextResponse } from "next/server";
import { runAcrioAutonomousTurn } from "@cc/connections";
import {
  deleteAiTrainingExample,
  deleteAiTrainingRule,
  ensureDatabasesBootstrapped,
  upsertAiTrainingExample,
  upsertAiTrainingRule,
} from "@cc/database";
import { hasPermission } from "@cc/rbac";
import { socketHub } from "@cc/sockets";
import { loadAiTrainingPayload } from "@/lib/loaders/operations";
import { getCurrentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user || !hasPermission(user.role, "inbox:view", user.status)) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  const payload = await loadAiTrainingPayload(user);
  return NextResponse.json({
    ok: true,
    canEdit: payload.canEdit,
    examples: payload.examples,
    rules: payload.rules,
    products: payload.products,
    recentCustomerQuestions: payload.recentCustomerQuestions,
  });
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user || !hasPermission(user.role, "inbox:view", user.status)) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  await ensureDatabasesBootstrapped();
  const body = await req.json().catch(() => ({}));
  const action = String(body.action || "");

  // Live Multi-Turn Simulator on AI Training Studio
  if (action === "simulate") {
    const messagesInput = Array.isArray(body.turns)
      ? body.turns.map((t: any) => ({
          direction: String(t.role === "assistant" ? "OUTBOUND" : "INBOUND"),
          body: String(t.text || ""),
        }))
      : [];
    const latestQuestion = String(body.question || "").trim();
    if (!latestQuestion) {
      return NextResponse.json(
        { ok: false, error: "Enter a customer test message first." },
        { status: 400 }
      );
    }

    const result = await runAcrioAutonomousTurn({
      customerName: String(body.customerName || "Test Customer"),
      inboundText: latestQuestion,
      recentMessages: messagesInput,
      persistedState: body.state || undefined,
      enableInteractive: false,
    });

    return NextResponse.json({
      ok: true,
      result,
    });
  }

  const canManage =
    hasPermission(user.role, "acrio:manage_training", user.status) ||
    hasPermission(user.role, "automations:manage", user.status) ||
    user.role === "STAFF"; // Allow active team members to submit verified Q&A improvements too if authorized
  if (!canManage) {
    return NextResponse.json({ ok: false, error: "Permission denied." }, { status: 403 });
  }

  if (action === "upsert_example") {
    const title = String(body.title || "").trim();
    const customerQuestion = String(body.customerQuestion || "").trim();
    const idealAnswer = String(body.idealAnswer || "").trim();
    const guidanceType =
      body.guidanceType === "INSTRUCTION" ? "INSTRUCTION" : "FIXED_ANSWER";
    if (!title || !customerQuestion || !idealAnswer) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Title, trigger situation or question, and instruction or answer are required.",
        },
        { status: 400 }
      );
    }
    const record = await upsertAiTrainingExample({
      id: body.id ? String(body.id) : undefined,
      title,
      category: body.category ? String(body.category) : "Product Knowledge",
      guidanceType,
      customerQuestion,
      idealAnswer,
      doNotSay: body.doNotSay ? String(body.doNotSay) : "",
      productSlug: body.productSlug ? String(body.productSlug) : "",
      priority: body.priority === "HIGH" ? "HIGH" : "NORMAL",
      isEnabled: body.isEnabled !== false,
      createdByName: user.name,
    });
    socketHub.emit("ai:training_updated", { type: "example", id: record.id });
    return NextResponse.json({ ok: true, example: record });
  }

  if (action === "delete_example") {
    await deleteAiTrainingExample(String(body.id || ""));
    socketHub.emit("ai:training_updated", { type: "example_deleted", id: body.id });
    return NextResponse.json({ ok: true });
  }

  if (action === "upsert_rule") {
    const title = String(body.title || "").trim();
    const ruleText = String(body.ruleText || "").trim();
    if (!title || !ruleText) {
      return NextResponse.json(
        { ok: false, error: "Rule title and instruction are required." },
        { status: 400 }
      );
    }
    const record = await upsertAiTrainingRule({
      id: body.id ? String(body.id) : undefined,
      title,
      ruleText,
      scope:
        body.scope === "CUSTOMER_CHAT" || body.scope === "STAFF_COPILOT"
          ? body.scope
          : "BOTH",
      isEnabled: body.isEnabled !== false,
      createdByName: user.name,
    });
    socketHub.emit("ai:training_updated", { type: "rule", id: record.id });
    return NextResponse.json({ ok: true, rule: record });
  }

  if (action === "delete_rule") {
    await deleteAiTrainingRule(String(body.id || ""));
    socketHub.emit("ai:training_updated", { type: "rule_deleted", id: body.id });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ ok: false, error: "Unsupported action" }, { status: 400 });
}
