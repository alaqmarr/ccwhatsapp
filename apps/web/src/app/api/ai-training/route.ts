import { NextResponse } from "next/server";
import { getCachedEcosystemCatalog, runAcrioAutonomousTurn } from "@cc/connections";
import {
  deleteAiTrainingExample,
  deleteAiTrainingRule,
  ensureDatabasesBootstrapped,
  getRawLibSqlClient,
  listAiTrainingData,
  upsertAiTrainingExample,
  upsertAiTrainingRule,
} from "@cc/database";
import { hasPermission } from "@cc/rbac";
import { socketHub } from "@cc/sockets";
import { getCurrentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user || !hasPermission(user.role, "inbox:view", user.status)) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  await ensureDatabasesBootstrapped();
  const [training, catalog, convRes] = await Promise.all([
    listAiTrainingData(),
    getCachedEcosystemCatalog().catch(() => ({ allItems: [] as any[] })),
    getRawLibSqlClient("conversations")
      .execute(
        `SELECT m.id, m.conversation_id, m.body, m.created_at, c.customer_name
         FROM messages m
         JOIN conversations c ON c.id = m.conversation_id
         WHERE m.direction = 'INBOUND' AND m.message_type = 'TEXT'
         ORDER BY m.created_at DESC LIMIT 25`
      )
      .catch(() => ({ rows: [] as any[] })),
  ]);

  const products = catalog.allItems.slice(0, 300).map((it) => ({
    slug: it.slug,
    name: it.name,
    sku: it.sku,
    brandLabel: it.brandLabel,
    priceInr: it.basePrice,
  }));

  const recentCustomerQuestions = convRes.rows.map((r) => ({
    id: String(r.id),
    conversationId: String(r.conversation_id),
    customerName: String(r.customer_name || "Customer"),
    question: String(r.body || "").slice(0, 220),
    createdAt: String(r.created_at || ""),
  }));

  return NextResponse.json({
    ok: true,
    canEdit:
      hasPermission(user.role, "acrio:manage_training", user.status) ||
      hasPermission(user.role, "automations:manage", user.status),
    examples: training.examples,
    rules: training.rules,
    products,
    recentCustomerQuestions,
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
    if (!title || !customerQuestion || !idealAnswer) {
      return NextResponse.json(
        { ok: false, error: "Title, customer question, and ideal answer are required." },
        { status: 400 }
      );
    }
    const record = await upsertAiTrainingExample({
      id: body.id ? String(body.id) : undefined,
      title,
      category: body.category ? String(body.category) : "Product Knowledge",
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
