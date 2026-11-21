import { NextResponse } from "next/server";
import { polishStaffOutboundMessage } from "@cc/connections";
import type { ConversationActionContext } from "./shared";

export async function handlePolishOutboundMessage(ctx: ConversationActionContext) {
  const { body, cRow } = ctx;
  const rawText = String(body.text || "").trim();
  if (!rawText) {
    return NextResponse.json(
      { ok: false, error: "Message text cannot be empty." },
      { status: 400 }
    );
  }

  const res = await polishStaffOutboundMessage({
    rawText,
    customerName: cRow.customer_name ? String(cRow.customer_name) : undefined,
  });

  return NextResponse.json({
    ok: true,
    originalText: res.originalText,
    enhancedText: res.enhancedText,
    changed: res.changed,
    source: res.source,
    durationMs: res.durationMs,
  });
}
