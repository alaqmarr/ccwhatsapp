import { NextResponse } from "next/server";
import { verifyMetaWebhookSignature } from "@cc/connections";
import { ensureDatabasesBootstrapped } from "@cc/database";
import { getCachedWebhookSecrets } from "@/lib/api/whatsapp-webhook/config-cache";
import { handleTemplateStatusUpdate } from "@/lib/api/whatsapp-webhook/template-status";
import { handleInboundMessage } from "@/lib/api/whatsapp-webhook/inbound-message";
import { handleStatusReceipts } from "@/lib/api/whatsapp-webhook/status-receipts";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  const { webhookVerifyToken } = await getCachedWebhookSecrets();
  if (mode === "subscribe" && token && token === webhookVerifyToken) {
    return new Response(challenge || "OK", { status: 200 });
  }

  return NextResponse.json({ ok: false, error: "Invalid verify token" }, { status: 403 });
}

export async function POST(req: Request) {
  await ensureDatabasesBootstrapped();
  const rawBody = await req.text();
  const { metaAppSecret } = await getCachedWebhookSecrets();

  const sig = req.headers.get("x-hub-signature-256");
  if (metaAppSecret && !verifyMetaWebhookSignature(rawBody, sig, metaAppSecret)) {
    return NextResponse.json({ ok: false, error: "Invalid signature" }, { status: 401 });
  }

  let payload: any = {};
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const nowIso = new Date().toISOString();

  for (const entry of payload?.entry || []) {
    for (const change of entry?.changes || []) {
      const val = change?.value || {};
      const contacts = val?.contacts || [];

      if (change?.field === "message_template_status_update") {
        await handleTemplateStatusUpdate(val, nowIso);
        continue;
      }

      for (const msg of val?.messages || []) {
        await handleInboundMessage(msg, contacts, nowIso);
      }

      await handleStatusReceipts(val?.statuses || []);
    }
  }

  return NextResponse.json({ ok: true });
}
