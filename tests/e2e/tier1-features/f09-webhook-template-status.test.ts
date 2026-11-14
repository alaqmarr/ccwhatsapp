import crypto from "node:crypto";
import {
  describe,
  it,
  assertStrictEqual,
  assertOk,
  createTestRequest,
  callRoute,
} from "../harness";
import { getRawLibSqlClient } from "@cc/database";
import { socketHub } from "@cc/sockets";
import * as whatsappWebhookRoute from "../../../apps/web/src/app/api/webhooks/whatsapp/route";

function createSignedWebhookRequest(body: unknown, secret = "c8d985700cd2266bc184703d329722e7") {
  const rawBody = typeof body === "string" ? body : JSON.stringify(body);
  const sig = "sha256=" + crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  return createTestRequest({
    url: "/api/webhooks/whatsapp",
    method: "POST",
    body: rawBody,
    headers: {
      "content-type": "application/json",
      "x-hub-signature-256": sig,
    },
  });
}

describe("F09: Webhook Template Status Updates & Query Guarding (Tier 1 Feature Coverage)", () => {
  it("T1-F09-01: updates template status to APPROVED on Meta webhook approval notification", async () => {
    const payload = {
      entry: [
        {
          changes: [
            {
              field: "message_template_status_update",
              value: {
                event: "APPROVED",
                message_template_id: "meta_tpl_hospitality_101",
                message_template_name: "hospitality_podium_menu_2026",
              },
            },
          ],
        },
      ],
    };

    const req = createSignedWebhookRequest(payload);
    const res = await callRoute(whatsappWebhookRoute, req);
    res.assertStatus(200);

    const mkt = getRawLibSqlClient("marketing");
    const tplRes = await mkt.execute({
      sql: `SELECT id, name, approval_status, meta_template_id FROM templates WHERE name = 'hospitality_podium_menu_2026' LIMIT 1`,
      args: [],
    });

    assertOk(tplRes.rows.length === 1);
    const tpl = tplRes.rows[0] as Record<string, unknown>;
    assertStrictEqual(tpl.approval_status, "APPROVED");
  });

  it("T1-F09-02: updates template status to REJECTED with rejection reason on Meta disapproval", async () => {
    const payload = {
      entry: [
        {
          changes: [
            {
              field: "message_template_status_update",
              value: {
                event: "REJECTED",
                message_template_id: "meta_tpl_college_102",
                message_template_name: "convocation_awards_season",
                reason: "INCORRECT_CATEGORY",
              },
            },
          ],
        },
      ],
    };

    const req = createSignedWebhookRequest(payload);
    const res = await callRoute(whatsappWebhookRoute, req);
    res.assertStatus(200);

    const mkt = getRawLibSqlClient("marketing");
    const tplRes = await mkt.execute({
      sql: `SELECT id, name, approval_status, rejection_reason FROM templates WHERE name = 'convocation_awards_season' LIMIT 1`,
      args: [],
    });

    assertOk(tplRes.rows.length === 1);
    const tpl = tplRes.rows[0] as Record<string, unknown>;
    assertStrictEqual(tpl.approval_status, "REJECTED");
    assertStrictEqual(tpl.rejection_reason, "INCORRECT_CATEGORY");
  });

  it("T1-F09-03: updates template status to PAUSED on Meta pause event", async () => {
    const payload = {
      entry: [
        {
          changes: [
            {
              field: "message_template_status_update",
              value: {
                event: "PAUSED",
                message_template_id: "meta_tpl_hospitality_101",
                message_template_name: "hospitality_podium_menu_2026",
              },
            },
          ],
        },
      ],
    };

    const req = createSignedWebhookRequest(payload);
    const res = await callRoute(whatsappWebhookRoute, req);
    res.assertStatus(200);

    const mkt = getRawLibSqlClient("marketing");
    const tplRes = await mkt.execute({
      sql: `SELECT id, approval_status FROM templates WHERE name = 'hospitality_podium_menu_2026' LIMIT 1`,
      args: [],
    });

    assertOk(tplRes.rows.length === 1);
    assertStrictEqual(tplRes.rows[0].approval_status, "PAUSED");
  });

  it("T1-F09-04: emits real-time template:updated socket notification on status transition", async () => {
    let capturedEvent: { type: string; payload: unknown } | null = null;
    const unsub = socketHub.subscribe((ev) => {
      if (ev.type === "template:updated") {
        capturedEvent = ev;
      }
    });

    try {
      const payload = {
        entry: [
          {
            changes: [
              {
                field: "message_template_status_update",
                value: {
                  event: "APPROVED",
                  message_template_id: "meta_tpl_hospitality_101",
                  message_template_name: "hospitality_podium_menu_2026",
                },
              },
            ],
          },
        ],
      };

      const req = createSignedWebhookRequest(payload);
      const res = await callRoute(whatsappWebhookRoute, req);
      res.assertStatus(200);

      assertOk(capturedEvent, "socketHub should have emitted template:updated");
      const eventData = (capturedEvent as { type: string; payload: { status: string } }).payload;
      assertStrictEqual(eventData.status, "APPROVED");
    } finally {
      unsub();
    }
  });

  it("T1-F09-05: verifies guarded template matching query does not match empty meta_template_id", async () => {
    const mkt = getRawLibSqlClient("marketing");

    // Insert a draft template with empty meta_template_id
    const draftId = `tpl_draft_test_${Date.now()}`;
    await mkt.execute({
      sql: `INSERT INTO templates (
        id, name, category, language, body_text, approval_status,
        meta_template_id, updated_at, created_at
      ) VALUES (?, 'unique_draft_unlinked', 'MARKETING', 'en', 'Draft body', 'DRAFT', '', datetime('now'), datetime('now'))`,
      args: [draftId],
    });

    // Webhook with a distinct message_template_id does not touch our draft template
    const payload = {
      entry: [
        {
          changes: [
            {
              field: "message_template_status_update",
              value: {
                event: "REJECTED",
                message_template_id: "meta_other_unrelated_id",
                message_template_name: "completely_unrelated_name",
              },
            },
          ],
        },
      ],
    };

    const req = createSignedWebhookRequest(payload);
    const res = await callRoute(whatsappWebhookRoute, req);
    res.assertStatus(200);

    const draftRes = await mkt.execute({
      sql: `SELECT approval_status FROM templates WHERE id = ? LIMIT 1`,
      args: [draftId],
    });

    assertOk(draftRes.rows.length === 1);
    assertStrictEqual(draftRes.rows[0].approval_status, "DRAFT");
  });
});
