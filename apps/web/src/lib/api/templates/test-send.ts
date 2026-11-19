import { NextResponse } from "next/server";
import type { AuthenticatedUser } from "@cc/auth";
import {
  sendWhatsAppCloudMessage,
  type WhatsAppTemplateButton,
  type WhatsAppTemplateLocation,
  type WhatsAppTemplateVariableSpec,
} from "@cc/connections";
import { getRawLibSqlClient } from "@cc/database";
import {
  recordDualPricingLedgerEntry,
  type BillingMessageCategory,
} from "@cc/workers";
import { parseJsonSafe } from "./helpers";

export async function handleSendTestTemplate(
  user: AuthenticatedUser,
  body: Record<string, unknown>
) {
  const mkt = getRawLibSqlClient("marketing");
  const tplId = String(body.templateId || "");
  const toPhone = String(body.toPhone || "").trim();
  if (!toPhone) {
    return NextResponse.json(
      { ok: false, error: "Enter a WhatsApp number to receive the test message." },
      { status: 400 }
    );
  }
  const tplRes = await mkt.execute({
    sql: `SELECT * FROM templates WHERE id = ? LIMIT 1`,
    args: [tplId],
  });
  if (!tplRes.rows[0]) {
    return NextResponse.json(
      { ok: false, error: "Template not found." },
      { status: 404 }
    );
  }
  const t = tplRes.rows[0] as Record<string, unknown>;
  if (String(t.approval_status || "") !== "APPROVED") {
    return NextResponse.json(
      {
        ok: false,
        error: `Only official Meta-APPROVED templates can be sent on WhatsApp (current status: ${String(
          t.approval_status || "DRAFT"
        )}). Submit this template to Meta for review first.`,
      },
      { status: 400 }
    );
  }
  const varSpecs = parseJsonSafe<WhatsAppTemplateVariableSpec[]>(
    t.variables_schema_json,
    []
  );
  let rendered = String(t.body_text || "");
  for (const v of varSpecs) {
    rendered = rendered.replace(
      new RegExp(`\\{\\{${v.index}\\}\\}`, "g"),
      v.sampleValue || "Sample"
    );
  }

  const headerType = String(t.header_type || "NONE");
  const headerMediaUrl = t.header_media_url ? String(t.header_media_url) : "";
  const tplBtns = parseJsonSafe<WhatsAppTemplateButton[]>(t.buttons_json, []);
  const comps: Record<string, unknown>[] = [];
  if (
    (headerType === "IMAGE" ||
      headerType === "VIDEO" ||
      headerType === "DOCUMENT") &&
    headerMediaUrl
  ) {
    const mk = headerType.toLowerCase();
    comps.push({
      type: "header",
      parameters: [{ type: mk, [mk]: { link: headerMediaUrl } }],
    });
  } else if (headerType === "LOCATION") {
    const loc = parseJsonSafe<WhatsAppTemplateLocation | null>(
      t.header_location_json,
      null
    );
    comps.push({
      type: "header",
      parameters: [
        {
          type: "location",
          location: {
            name: loc?.name || "Classic Concepts",
            address: loc?.address || "Rani Gunj, Secunderabad, Hyderabad",
            latitude: String(loc?.latitude ?? 17.4326),
            longitude: String(loc?.longitude ?? 78.4913),
          },
        },
      ],
    });
  }
  if (varSpecs.length > 0) {
    comps.push({
      type: "body",
      parameters: varSpecs
        .sort((a, b) => a.index - b.index)
        .map((v) => ({ type: "text", text: v.sampleValue || "Sample" })),
    });
  }
  tplBtns.forEach((b, idx) => {
    if (b.type === "COPY_CODE") {
      comps.push({
        type: "button",
        sub_type: "copy_code",
        index: String(idx),
        parameters: [
          { type: "coupon_code", coupon_code: b.exampleCode || "CLASSIC10" },
        ],
      });
    } else if (
      b.type === "URL" &&
      (b.urlType === "DYNAMIC" || /\{\{1\}\}/.test(b.url || ""))
    ) {
      comps.push({
        type: "button",
        sub_type: "url",
        index: String(idx),
        parameters: [{ type: "text", text: b.exampleSuffix || "CC-2026" }],
      });
    }
  });

  const sendRes = await sendWhatsAppCloudMessage({
    toPhone,
    bodyText: rendered,
    templateName: String(t.name),
    languageCode: String(t.language || "en"),
    templateComponents: comps,
  });
  if (!sendRes.ok) {
    return NextResponse.json(
      { ok: false, error: sendRes.error || "Test send failed." },
      { status: 400 }
    );
  }

  const cat = String(t.category || "MARKETING") as BillingMessageCategory;
  await recordDualPricingLedgerEntry({
    customerPhone: toPhone,
    category: cat,
    staffName: `Template Test (${user.name})`,
    deliveryMode: sendRes.mode,
  });
  await mkt.execute({
    sql: `UPDATE templates SET sent_count = sent_count + 1 WHERE id = ?`,
    args: [tplId],
  });

  return NextResponse.json({
    ok: true,
    mode: sendRes.mode,
    message: `Sent test message of "${String(t.name)}" to ${toPhone}.`,
  });
}
